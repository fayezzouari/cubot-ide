"""
Kubernetes Sandbox Service

Runs each ROS project in its own Kubernetes pod and talks to it through the
pods/exec API (the same mechanism `kubectl exec` uses). Syncs project files
into the pod so users can test code against the full project structure.

Cluster access is resolved in this order:
  1. In-cluster service account (backend running inside Kubernetes)
  2. Kubeconfig file ($KUBECONFIG, or ~/.kube/config)
"""
import asyncio
import base64
import json
import logging
import re
import threading
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, timezone

import yaml
from kubernetes import client, config
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream
from kubernetes.stream.ws_client import RESIZE_CHANNEL, WSClient

from core.config import settings
from schemas.sandbox import (
    SandboxWorkspaceCreate,
    SandboxWorkspaceResponse,
    WorkspaceState,
    CodeExecutionRequest,
    CodeExecutionResponse,
)
from services.file_service import FileService
from services.project_service import project_service

logger = logging.getLogger(__name__)


PROJECT_BASE_DIR = "/root/project"
SANDBOX_CONTAINER = "sandbox"
SANDBOX_LABEL = "cubot.io/sandbox"
PROJECT_LABEL = "cubot.io/project-id"

ROS_ENV = {
    "ROS_DISTRO": "humble",
    "ROS_VERSION": "2",
    "ROS_PYTHON_VERSION": "3",
    "DEBIAN_FRONTEND": "noninteractive",
    "LANG": "C.UTF-8",
}

# Runs once as the container entrypoint: make every shell (login, interactive,
# root or not) source ROS, create the project dir, then idle forever so we can exec in.
POD_BOOTSTRAP = (
    'ROS_LINE="source /opt/ros/humble/setup.bash"; '
    'grep -qxF "$ROS_LINE" /etc/bash.bashrc || echo "$ROS_LINE" >> /etc/bash.bashrc; '
    'grep -qxF "$ROS_LINE" /root/.bashrc    || echo "$ROS_LINE" >> /root/.bashrc; '
    'printf "#!/bin/bash\\n$ROS_LINE\\n" > /etc/profile.d/ros-humble.sh; '
    f"mkdir -p {PROJECT_BASE_DIR}; "
    "exec sleep infinity"
)


def _as_bytes(data) -> bytes:
    """The client returns "" (str) for an empty channel even in binary mode."""
    return data.encode("utf-8") if isinstance(data, str) else data


class ExecResult:
    """Outcome of a non-interactive command run inside a sandbox pod."""

    def __init__(self, exit_code: int, stdout: str, stderr: str):
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr


class SandboxService:
    """
    Service for managing Kubernetes sandbox pods.

    One pod per ROS project, named deterministically from the project id so
    that a restarted backend reconnects to the pod it created earlier.
    """

    def __init__(self):
        self.namespace = settings.SANDBOX_NAMESPACE
        self._pods: Dict[str, str] = {}  # workspace_id -> pod name
        self._workspace_metadata: Dict[str, Dict[str, Any]] = {}
        # Per-workspace locks prevent duplicate pod creation when multiple
        # coroutines (e.g. background provisioning task + terminal open) call
        # create_workspace for the same project simultaneously.
        self._workspace_locks: Dict[str, asyncio.Lock] = {}
        self._core: Optional[client.CoreV1Api] = None

    @property
    def core(self) -> client.CoreV1Api:
        """Lazily load cluster credentials so the backend boots without a cluster."""
        if self._core is None:
            try:
                config.load_incluster_config()
                logger.info("✓ Kubernetes client using in-cluster config")
            except config.ConfigException:
                config.load_kube_config()
                logger.info("✓ Kubernetes client using kubeconfig")
            self._core = client.CoreV1Api()
        return self._core

    # ── Low-level pod helpers ────────────────────────────────────────────────

    def _exec_stream(self, pod_name: str, command: List[str], *, stdin: bool = False, tty: bool = False) -> WSClient:
        """Open a pods/exec websocket (equivalent to `kubectl exec`)."""
        # stream() temporarily swaps the ApiClient's request function, so a shared
        # client would break REST calls running concurrently in other threads.
        exec_api = client.CoreV1Api(client.ApiClient(self.core.api_client.configuration))
        return stream(
            exec_api.connect_get_namespaced_pod_exec,
            pod_name,
            self.namespace,
            container=SANDBOX_CONTAINER,
            command=command,
            stdin=stdin,
            stdout=True,
            stderr=not tty,
            tty=tty,
            binary=True,
            _preload_content=False,
        )

    def _exec_blocking(
        self,
        pod_name: str,
        command: List[str],
        stdin_data: Optional[bytes] = None,
        timeout: int = 30,
    ) -> ExecResult:
        """Run a command to completion inside the pod. Blocking — call via asyncio.to_thread."""
        ws = self._exec_stream(pod_name, command, stdin=stdin_data is not None)
        try:
            if stdin_data:
                ws.write_stdin(stdin_data)
            ws.run_forever(timeout=timeout)
            # timeout=0: never block waiting for more frames (the default of None
            # would hang forever if the command timed out without output)
            stdout = _as_bytes(ws.read_stdout(timeout=0)).decode("utf-8", errors="replace")
            stderr = _as_bytes(ws.read_stderr(timeout=0)).decode("utf-8", errors="replace")
            if ws.is_open():
                return ExecResult(124, stdout, stderr + f"\nCommand timed out after {timeout}s")
            return ExecResult(self._exit_code(ws), stdout, stderr)
        finally:
            ws.close()

    @staticmethod
    def _exit_code(ws: WSClient) -> int:
        """Parse the exit status Kubernetes reports on the error channel."""
        raw = ws.read_channel(3)
        if not raw:
            return 0
        status = yaml.safe_load(raw)
        if status.get("status") == "Success":
            return 0
        try:
            return int(status["details"]["causes"][0]["message"])
        except (KeyError, IndexError, ValueError, TypeError):
            return 1

    async def _exec(
        self,
        pod_name: str,
        script: str,
        *args: str,
        stdin_data: Optional[bytes] = None,
        timeout: int = 30,
    ) -> ExecResult:
        """Run a bash script in the pod. Extra args are passed as $1, $2… (no shell quoting needed)."""
        command = ["/bin/bash", "-c", script, "bash", *args]
        return await asyncio.to_thread(self._exec_blocking, pod_name, command, stdin_data, timeout)

    async def _write_file(self, pod_name: str, path: str, content: bytes) -> None:
        """Write bytes to a file in the pod, creating parent directories."""
        # `head -c N` exits after exactly N bytes, so we never need to close stdin
        # (closing stdin is only supported on the v5 exec protocol).
        result = await self._exec(
            pod_name,
            'mkdir -p "$(dirname "$1")" && head -c "$2" > "$1"',
            path,
            str(len(content)),
            stdin_data=content,
        )
        if result.exit_code != 0:
            raise RuntimeError(f"Failed to write {path}: {result.stderr.strip()}")

    async def _read_file(self, pod_name: str, path: str) -> bytes:
        """Read a file from the pod. Base64 keeps binary content intact over the text channel."""
        result = await self._exec(pod_name, 'base64 "$1"', path)
        if result.exit_code != 0:
            raise ValueError(f"Failed to read {path}: {result.stderr.strip()}")
        return base64.b64decode(result.stdout)

    def _get_workspace_lock(self, workspace_id: str) -> asyncio.Lock:
        """Return (creating if needed) the asyncio.Lock for a workspace_id."""
        if workspace_id not in self._workspace_locks:
            self._workspace_locks[workspace_id] = asyncio.Lock()
        return self._workspace_locks[workspace_id]

    @staticmethod
    def _pod_name(project_id: str) -> str:
        """Deterministic, DNS-1123 compliant pod name for a project."""
        safe_id = re.sub(r"[^a-z0-9-]", "-", project_id.lower()).strip("-")
        return f"ros-project-{safe_id}"[:63].rstrip("-")

    async def _get_pod(self, pod_name: str) -> Optional[client.V1Pod]:
        try:
            return await asyncio.to_thread(self.core.read_namespaced_pod, pod_name, self.namespace)
        except ApiException as e:
            if e.status == 404:
                return None
            raise

    async def _delete_pod(self, pod_name: str, wait: bool = False) -> None:
        try:
            await asyncio.to_thread(
                self.core.delete_namespaced_pod,
                pod_name,
                self.namespace,
                grace_period_seconds=0,
            )
            logger.info(f"Deleted pod {pod_name}")
        except ApiException as e:
            if e.status != 404:
                raise
            return

        if wait:
            for _ in range(60):
                if await self._get_pod(pod_name) is None:
                    return
                await asyncio.sleep(1)
            logger.warning(f"Pod {pod_name} still terminating after 60s")

    async def _wait_for_pod_running(self, pod_name: str, timeout: int = None) -> None:
        """Poll until the pod is Running. Raises if it fails or times out (image pull can be slow)."""
        timeout = timeout or settings.SANDBOX_STARTUP_TIMEOUT
        loop = asyncio.get_event_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            pod = await self._get_pod(pod_name)
            phase = pod.status.phase if pod and pod.status else None
            if phase == "Running":
                logger.info(f"Pod {pod_name} is running")
                return
            if phase in ("Failed", "Succeeded"):
                raise RuntimeError(f"Pod {pod_name} exited with phase {phase}")
            for cs in (pod.status.container_statuses or []) if pod and pod.status else []:
                waiting = cs.state.waiting if cs.state else None
                if waiting and waiting.reason in ("ErrImagePull", "ImagePullBackOff", "InvalidImageName"):
                    raise RuntimeError(f"Pod {pod_name} cannot pull image: {waiting.message or waiting.reason}")
            await asyncio.sleep(2)
        raise TimeoutError(f"Pod {pod_name} not running after {timeout}s")

    def _build_pod_manifest(self, pod_name: str, project_id: str) -> client.V1Pod:
        """Pod spec for a ROS Humble sandbox."""
        resources = client.V1ResourceRequirements(
            requests={"cpu": settings.SANDBOX_CPU_REQUEST, "memory": settings.SANDBOX_MEMORY_REQUEST},
            limits={"cpu": settings.SANDBOX_CPU_LIMIT, "memory": settings.SANDBOX_MEMORY_LIMIT},
        )
        container = client.V1Container(
            name=SANDBOX_CONTAINER,
            image=settings.SANDBOX_IMAGE,
            image_pull_policy="IfNotPresent",
            command=["/bin/bash", "-c", POD_BOOTSTRAP],
            env=[client.V1EnvVar(name=k, value=v) for k, v in ROS_ENV.items()],
            working_dir="/root",
            resources=resources,
            volume_mounts=[client.V1VolumeMount(name="project", mount_path=PROJECT_BASE_DIR)],
        )
        return client.V1Pod(
            metadata=client.V1ObjectMeta(
                name=pod_name,
                labels={SANDBOX_LABEL: "true", PROJECT_LABEL: project_id},
            ),
            spec=client.V1PodSpec(
                containers=[container],
                restart_policy="Always",
                # User code runs in this pod — never hand it cluster credentials.
                automount_service_account_token=False,
                enable_service_links=False,
                termination_grace_period_seconds=0,
                volumes=[
                    client.V1Volume(
                        name="project",
                        empty_dir=client.V1EmptyDirVolumeSource(size_limit=settings.SANDBOX_DISK_LIMIT),
                    )
                ],
            ),
        )

    # ── Workspace lifecycle ──────────────────────────────────────────────────

    def _create_workspace_response(
        self,
        workspace_id: str,
        project_id: str,
        pod_name: str
    ) -> SandboxWorkspaceResponse:
        """Create a SandboxWorkspaceResponse object."""
        return SandboxWorkspaceResponse(
            workspace_id=workspace_id,
            project_id=project_id,
            state=WorkspaceState.RUNNING,
            created_at=datetime.now(timezone.utc).isoformat(),
            metadata={
                "mode": "kubernetes",
                "sandbox_id": pod_name,
                "namespace": self.namespace,
            },
        )

    async def _sync_and_finalize_workspace(
        self,
        workspace: SandboxWorkspaceResponse,
        workspace_id: str,
        project_id: str
    ) -> SandboxWorkspaceResponse:
        """Sync project files and finalize workspace setup."""
        sync_result = await self.sync_project_files(workspace_id, project_id)
        workspace.files_synced = sync_result["files_synced"]
        has_errors = len(sync_result["errors"]) > 0

        if sync_result["files_synced"] > 0:
            workspace.sync_status = "partial" if has_errors else "synced"
        elif has_errors:
            workspace.sync_status = "failed"

        self._workspace_metadata[workspace_id] = workspace.model_dump()
        return workspace

    async def create_workspace(
        self,
        request: SandboxWorkspaceCreate
    ) -> SandboxWorkspaceResponse:
        """
        Create (or reconnect to) the sandbox pod for a project.

        Workflow:
        1. Check if pod is known in memory (fast path)
        2. Reconnect to an existing running pod for this project
        3. Otherwise delete any broken leftover and create a new pod

        Args:
            request: Workspace creation parameters

        Returns:
            Workspace information with sync status
        """
        workspace_id = f"sandbox-{request.project_id}"

        # ── Fast path (no lock needed) ────────────────────────────────────────
        if workspace_id in self._pods:
            logger.info(f"Reusing existing sandbox from memory: {workspace_id}")
            return SandboxWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=self._workspace_metadata[workspace_id]["created_at"],
                metadata=self._workspace_metadata[workspace_id],
            )

        # ── Serialize per-project to prevent concurrent duplicate creation ────
        # The background provisioning task (started at project-creation time) and
        # the terminal's first createWorkspace call can race.  One of them will
        # acquire the lock and complete setup; the other will fast-path out on
        # the re-check below.
        lock = self._get_workspace_lock(workspace_id)
        async with lock:
            # Re-check: the first waiter may have completed setup while we waited.
            if workspace_id in self._pods:
                logger.info(f"Reusing existing sandbox from memory (post-lock): {workspace_id}")
                return SandboxWorkspaceResponse(
                    workspace_id=workspace_id,
                    project_id=request.project_id,
                    state=WorkspaceState.RUNNING,
                    created_at=self._workspace_metadata[workspace_id]["created_at"],
                    metadata=self._workspace_metadata[workspace_id],
                )

            pod_name = self._pod_name(request.project_id)
            workspace = await self._try_reconnect_pod(workspace_id, request.project_id, pod_name)
            if workspace:
                return workspace

            return await self._create_new_pod(workspace_id, request.project_id, pod_name)

    async def _try_reconnect_pod(
        self,
        workspace_id: str,
        project_id: str,
        pod_name: str
    ) -> Optional[SandboxWorkspaceResponse]:
        """
        Reconnect to the project's pod if it already exists (e.g. after a backend restart).
        Pods still starting are waited for; broken pods are deleted so they can be recreated.

        Returns:
            Workspace response if successful, None otherwise
        """
        pod = await self._get_pod(pod_name)
        if pod is None:
            return None

        try:
            if pod.metadata.deletion_timestamp is None:
                await self._wait_for_pod_running(pod_name)
                logger.info(f"Reconnected to existing pod {pod_name}")
                return await self._finalize_sandbox_connection(workspace_id, project_id, pod_name)
        except Exception as e:
            logger.warning(f"Existing pod {pod_name} unusable, recreating: {e}")

        await self._delete_pod(pod_name, wait=True)
        await project_service.update_sandbox_id(project_id, None)
        return None

    async def _finalize_sandbox_connection(
        self,
        workspace_id: str,
        project_id: str,
        pod_name: str
    ) -> SandboxWorkspaceResponse:
        """Store pod in memory, sync files, and return workspace response."""
        self._pods[workspace_id] = pod_name
        workspace = self._create_workspace_response(workspace_id, project_id, pod_name)
        self._workspace_metadata[workspace_id] = workspace.model_dump()
        return await self._sync_and_finalize_workspace(workspace, workspace_id, project_id)

    @staticmethod
    def _ros_package_name(project_name: str) -> str:
        """Derive a valid ROS 2 / Python package name from a project name.

        Rules: lowercase, any non-alphanumeric char → underscore,
        collapse consecutive underscores, strip leading/trailing underscores.
        """
        name = project_name.lower().strip()
        name = re.sub(r'[^a-z0-9]+', '_', name)
        name = name.strip('_')
        return name or "ros_project"

    async def _setup_ros_workspace(self, pod_name: str, pkg_name: str) -> None:
        """
        Initialize the ROS 2 workspace inside the pod after creation.

        Creates a full ament_python package structure under src/<pkg_name>/:
          package.xml, setup.py, setup.cfg, resource/<pkg_name>, <pkg_name>/__init__.py

        File contents are streamed over stdin to avoid any shell-quoting issues.

        rosdep update is intentionally omitted (slow network call).
        """
        logger.info(f"Setting up ROS workspace for package '{pkg_name}'...")

        pkg_dir = f"{PROJECT_BASE_DIR}/src/{pkg_name}"
        py_dir = f"{pkg_dir}/{pkg_name}"
        resource_dir = f"{pkg_dir}/resource"

        # ── File contents (real Python newlines — no shell quoting needed) ──

        package_xml = (
            f'<?xml version="1.0"?>\n'
            f'<package format="3">\n'
            f'  <name>{pkg_name}</name>\n'
            f'  <version>0.0.1</version>\n'
            f'  <description>{pkg_name} ROS 2 package</description>\n'
            f'  <maintainer email="user@example.com">user</maintainer>\n'
            f'  <license>Apache-2.0</license>\n'
            f'  <exec_depend>rclpy</exec_depend>\n'
            f'  <export>\n'
            f'    <build_type>ament_python</build_type>\n'
            f'  </export>\n'
            f'</package>\n'
        )

        setup_py = (
            f"from setuptools import setup\n\n"
            f"package_name = '{pkg_name}'\n\n"
            f"setup(\n"
            f"    name=package_name,\n"
            f"    version='0.0.1',\n"
            f"    packages=[package_name],\n"
            f"    data_files=[\n"
            f"        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),\n"
            f"        ('share/' + package_name, ['package.xml']),\n"
            f"    ],\n"
            f"    install_requires=['setuptools'],\n"
            f"    zip_safe=True,\n"
            f"    entry_points={{\n"
            f"        'console_scripts': [],\n"
            f"    }},\n"
            f")\n"
        )

        setup_cfg = (
            f"[develop]\n"
            f"script_dir=$base/lib/{pkg_name}\n"
            f"[install]\n"
            f"install_scripts=$base/lib/{pkg_name}\n"
        )

        try:
            # 1. Create dirs and marker files (shell rc files are patched by the pod bootstrap)
            result = await self._exec(
                pod_name,
                'mkdir -p "$1" "$2" && touch "$2/$3" "$1/__init__.py"',
                py_dir,
                resource_dir,
                pkg_name,
            )
            if result.exit_code != 0:
                logger.warning(
                    f"ROS scaffold returned non-zero ({result.exit_code}): "
                    f"{result.stderr[:300]}"
                )

            # 2. Upload file contents directly — zero quoting issues
            await self._write_file(pod_name, f"{pkg_dir}/package.xml", package_xml.encode("utf-8"))
            await self._write_file(pod_name, f"{pkg_dir}/setup.py", setup_py.encode("utf-8"))
            await self._write_file(pod_name, f"{pkg_dir}/setup.cfg", setup_cfg.encode("utf-8"))

            logger.info(f"✓ ROS package '{pkg_name}' scaffold created")
        except Exception as e:
            logger.warning(f"ROS workspace setup failed (non-fatal): {e}")

    async def _build_ros_workspace(self, pod_name: str, pkg_name: str) -> None:
        """
        Run `colcon build` inside the pod to compile the freshly scaffolded
        ROS 2 package and make it importable in every subsequent terminal session.

        Also appends `source install/setup.bash` to /root/.bashrc so that
        new PTY shells have the overlay sourced automatically.

        This step is best-effort: failures are logged but never raised.
        """
        logger.info("Building ROS 2 workspace with colcon…")

        install_setup = f"{PROJECT_BASE_DIR}/install/setup.bash"

        build_sh = (
            "set -e\n"
            # Install colcon if missing (apt path; pip fallback not needed for Humble)
            "command -v colcon > /dev/null 2>&1 \\\n"
            "  || (apt-get update -qq && apt-get install -y -q python3-colcon-common-extensions)\n"
            f"cd {PROJECT_BASE_DIR}\n"
            "source /opt/ros/humble/setup.bash\n"
            "colcon build\n"
            # Patch .bashrc so future PTY sessions have the local overlay sourced
            f'if [ -f "{install_setup}" ]; then\n'
            f'  grep -qF "{install_setup}" /root/.bashrc \\\n'
            f'    || printf "\\n# ROS 2 local workspace overlay\\n'
            f'[ -f {install_setup} ] && source {install_setup}\\n" >> /root/.bashrc\n'
            "fi\n"
        )

        try:
            result = await self._exec(pod_name, build_sh, timeout=180)
            if result.exit_code != 0:
                logger.warning(
                    f"colcon build returned non-zero ({result.exit_code}): "
                    f"{(result.stderr or result.stdout)[:300]}"
                )
            else:
                logger.info("✓ colcon build succeeded; workspace overlay sourced in .bashrc")
        except Exception as e:
            logger.warning(f"colcon build failed (non-fatal): {e}")

    async def _create_new_pod(
        self,
        workspace_id: str,
        project_id: str,
        pod_name: str
    ) -> SandboxWorkspaceResponse:
        """Create a new ROS Humble sandbox pod."""
        logger.info(f"Creating new ROS Humble sandbox pod for project: {project_id}")

        # Derive ROS package name from project name
        project = await project_service.get_project(project_id)
        pkg_name = self._ros_package_name(project.name) if project else "ros_project"
        logger.info(f"ROS package name: '{pkg_name}'")

        manifest = self._build_pod_manifest(pod_name, project_id)
        try:
            await asyncio.to_thread(self.core.create_namespaced_pod, self.namespace, manifest)
        except ApiException as e:
            # A pod from a previous run is still terminating — wait it out and retry once
            if e.status != 409:
                logger.error(f"Pod creation failed: {e}", exc_info=True)
                raise
            logger.warning(f"Pod '{pod_name}' already exists, deleting and retrying...")
            await self._delete_pod(pod_name, wait=True)
            await asyncio.to_thread(self.core.create_namespaced_pod, self.namespace, manifest)

        logger.info(f"Pod created: {pod_name}, waiting for it to start...")
        try:
            await self._wait_for_pod_running(pod_name)
        except Exception:
            await self._delete_pod(pod_name)
            raise

        # ── Store pod in memory and DB immediately ──────────────────────────
        # This MUST happen before any long-running setup step so that any
        # concurrent createWorkspace call (e.g., from the terminal opening
        # while the background task is still running) fast-paths to this
        # pod instead of trying to create a duplicate.
        self._pods[workspace_id] = pod_name
        self._workspace_metadata[workspace_id] = {
            "workspace_id": workspace_id,
            "project_id": project_id,
            "state": WorkspaceState.RUNNING.value,
            "sandbox_id": pod_name,
            "pkg_name": pkg_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "files_synced": 0,
            "sync_status": "none",
        }
        await project_service.update_sandbox_id(project_id, pod_name)
        logger.info(f"Saved sandbox pod {pod_name} to project {project_id}")

        # Set up the ROS package scaffold (fast).  This runs while the
        # per-workspace lock is still held, so no other coroutine can attempt
        # to create a duplicate pod before we finish.
        await self._setup_ros_workspace(pod_name, pkg_name)

        # Kick off `colcon build` as a fire-and-forget asyncio task so the lock
        # is released promptly.  The build can take several minutes; the terminal
        # PTY will be usable while it runs in the background.
        asyncio.create_task(self._build_ros_workspace(pod_name, pkg_name))

        # Finalize: sync project files and update metadata with sync status.
        # Still inside the lock, but finalize is fast (file upload).
        return await self._finalize_sandbox_connection(workspace_id, project_id, pod_name)

    async def sync_project_files(
        self,
        workspace_id: str,
        project_id: str
    ) -> Dict[str, Any]:
        """
        Sync project files from MongoDB into the pod filesystem.

        Files are placed inside the ROS package Python module directory:
          src/<pkg_name>/<pkg_name>/<file>
        so they are importable by the package and picked up by colcon.

        Falls back to PROJECT_BASE_DIR if no pkg_name is recorded (legacy/non-ROS).
        """
        pod_name = self._pods.get(workspace_id)
        if not pod_name:
            return {"files_synced": 0, "errors": ["Sandbox not found"]}

        # Determine sync root: package python module dir if available
        pkg_name = self._workspace_metadata.get(workspace_id, {}).get("pkg_name")
        if pkg_name:
            sync_root = f"{PROJECT_BASE_DIR}/src/{pkg_name}/{pkg_name}"
        else:
            sync_root = PROJECT_BASE_DIR

        # Fetch project files from MongoDB
        try:
            files = await FileService.get_files_by_project(project_id)
        except Exception as e:
            logger.error(f"Failed to fetch project files: {e}")
            return {"files_synced": 0, "errors": [f"Failed to fetch files: {e}"]}

        if not files:
            logger.info(f"No files found for project {project_id}")
            return {"files_synced": 0, "errors": []}

        synced = 0
        errors: List[str] = []

        for file_doc in files:
            try:
                file_path = file_doc.path or ""
                file_name = file_doc.name or ""
                content = file_doc.content or ""

                if not file_name:
                    continue

                # Build directory path relative to sync_root
                if file_path and file_path not in ("/", "."):
                    full_dir = f"{sync_root}/{file_path.strip('/')}"
                else:
                    full_dir = sync_root

                # Write file to pod (parent directories are created as needed)
                full_file_path = f"{full_dir}/{file_name}"
                await self._write_file(pod_name, full_file_path, content.encode("utf-8"))
                synced += 1
                logger.debug(f"Synced file: {full_file_path}")

            except Exception as e:
                error_msg = f"Failed to sync {file_doc.name}: {e}"
                logger.error(error_msg)
                errors.append(error_msg)

        logger.info(
            f"Synced {synced}/{len(files)} files for project {project_id} "
            f"into {sync_root} (pod {pod_name})"
        )
        return {"files_synced": synced, "errors": errors}

    async def execute_code(
        self,
        request: CodeExecutionRequest
    ) -> CodeExecutionResponse:
        """
        Execute a shell command in the project's sandbox pod.

        Args:
            request: Command execution parameters (code field contains the shell command)

        Returns:
            Execution results including stdout, stderr, and exit code
        """
        pod_name = self._pods.get(request.workspace_id)
        if not pod_name:
            return CodeExecutionResponse(
                success=False,
                stdout="",
                stderr="Sandbox not found",
                exit_code=1,
                execution_time=0,
                error="Sandbox not found",
            )

        start_time = asyncio.get_event_loop().time()
        try:
            logger.debug(f"Executing command in pod {pod_name}: {request.code}")

            # Source ROS if installed, then run the command from the project dir.
            # The command is passed as $1 and eval'd, so it needs no extra quoting.
            result = await self._exec(
                pod_name,
                'if [ -f /opt/ros/humble/setup.bash ]; then source /opt/ros/humble/setup.bash; fi; '
                f'cd {PROJECT_BASE_DIR} && eval "$1"',
                request.code,
                timeout=request.timeout or 30,
            )

            execution_time = asyncio.get_event_loop().time() - start_time
            logger.debug(f"Command response: exit_code={result.exit_code}, stdout_len={len(result.stdout)}")

            return CodeExecutionResponse(
                success=result.exit_code == 0,
                stdout=result.stdout,
                stderr=result.stderr,
                exit_code=result.exit_code,
                execution_time=execution_time,
            )

        except Exception as e:
            logger.error(f"Command execution failed: {e}", exc_info=True)
            execution_time = asyncio.get_event_loop().time() - start_time
            return CodeExecutionResponse(
                success=False,
                stdout="",
                stderr=str(e),
                exit_code=1,
                execution_time=execution_time,
                error=str(e),
            )

    async def stop_workspace(self, workspace_id: str) -> None:
        """Delete the sandbox pod for a workspace."""
        pod_name = self._pods.pop(workspace_id, None)
        if pod_name:
            # Extract project_id from workspace_id (format: "sandbox-{project_id}")
            project_id = workspace_id.replace("sandbox-", "", 1)
            try:
                await self._delete_pod(pod_name)
                await project_service.update_sandbox_id(project_id, None)
                logger.info(f"Cleared sandbox ID from project {project_id}")
            except Exception as e:
                logger.error(f"Failed to stop sandbox: {e}")

        self._workspace_metadata.pop(workspace_id, None)

    async def get_workspace(self, workspace_id: str) -> Optional[SandboxWorkspaceResponse]:
        """Get workspace information"""
        workspace_metadata = self._workspace_metadata.get(workspace_id)
        if workspace_metadata:
            return SandboxWorkspaceResponse(**workspace_metadata)
        return None

    def _get_workspace_by_project(self, project_id: str) -> Optional[str]:
        """Find workspace ID by project ID"""
        for workspace_id, metadata in self._workspace_metadata.items():
            if metadata.get("project_id") == project_id:
                return workspace_id
        return None

    @staticmethod
    def _project_path(dir_path: str, file_name: str = "") -> str:
        """Absolute path under PROJECT_BASE_DIR for an IDE directory + optional file name."""
        if dir_path and dir_path not in ("/", "."):
            base = f"{PROJECT_BASE_DIR}/{dir_path.strip('/')}"
        else:
            base = PROJECT_BASE_DIR
        return f"{base}/{file_name}" if file_name else base

    def _pod_for_project(self, project_id: str) -> Tuple[Optional[str], Optional[str]]:
        """Return (pod_name, error) for a project's active sandbox."""
        workspace_id = self._get_workspace_by_project(project_id)
        if not workspace_id:
            return None, "No active workspace for project"
        pod_name = self._pods.get(workspace_id)
        if not pod_name:
            return None, "Sandbox not found"
        return pod_name, None

    async def sync_file_add(
        self,
        project_id: str,
        file_path: str,
        file_name: str,
        content: str
    ) -> Dict[str, Any]:
        """
        Sync a newly added file to the sandbox pod.

        Args:
            project_id: Project ID
            file_path: Directory path for the file
            file_name: Name of the file
            content: File content

        Returns:
            Dict with success status and any error message
        """
        pod_name, error = self._pod_for_project(project_id)
        if error:
            return {"success": False, "error": error}

        try:
            full_file_path = self._project_path(file_path, file_name)
            await self._write_file(pod_name, full_file_path, content.encode("utf-8"))
            logger.info(f"Synced new file to sandbox: {full_file_path}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Failed to sync file add: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def sync_file_update(
        self,
        project_id: str,
        file_path: str,
        file_name: str,
        content: str
    ) -> Dict[str, Any]:
        """
        Sync file content update to the sandbox pod.

        Args:
            project_id: Project ID
            file_path: Directory path for the file
            file_name: Name of the file
            content: Updated file content

        Returns:
            Dict with success status and any error message
        """
        # For updates, we can reuse the add logic since writes overwrite
        return await self.sync_file_add(project_id, file_path, file_name, content)

    async def sync_file_delete(
        self,
        project_id: str,
        file_path: str,
        file_name: str
    ) -> Dict[str, Any]:
        """
        Sync file deletion to the sandbox pod.

        Args:
            project_id: Project ID
            file_path: Directory path for the file
            file_name: Name of the file

        Returns:
            Dict with success status and any error message
        """
        pod_name, error = self._pod_for_project(project_id)
        if error:
            return {"success": False, "error": error}

        try:
            full_file_path = self._project_path(file_path, file_name)
            result = await self._exec(pod_name, 'rm -f -- "$1"', full_file_path)
            if result.exit_code != 0:
                raise RuntimeError(result.stderr.strip())

            logger.info(f"Deleted file from sandbox: {full_file_path}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Failed to sync file delete: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def sync_file_rename(
        self,
        project_id: str,
        old_path: str,
        old_name: str,
        new_path: str,
        new_name: str
    ) -> Dict[str, Any]:
        """
        Sync file rename/move to the sandbox pod.

        Args:
            project_id: Project ID
            old_path: Original directory path
            old_name: Original file name
            new_path: New directory path
            new_name: New file name

        Returns:
            Dict with success status and any error message
        """
        pod_name, error = self._pod_for_project(project_id)
        if error:
            return {"success": False, "error": error}

        try:
            old_full_path = self._project_path(old_path, old_name)
            new_full_path = self._project_path(new_path, new_name)

            result = await self._exec(
                pod_name,
                'mkdir -p "$(dirname "$2")" && mv -f -- "$1" "$2"',
                old_full_path,
                new_full_path,
            )
            if result.exit_code != 0:
                raise RuntimeError(result.stderr.strip())

            logger.info(f"Renamed file in sandbox: {old_full_path} -> {new_full_path}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Failed to sync file rename: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def list_sandbox_files(self, workspace_id: str) -> List[Dict[str, str]]:
        """
        List all entries (files AND directories) in the pod under PROJECT_BASE_DIR.

        Returns a list of dicts with 'path' (relative to PROJECT_BASE_DIR) and
        'type' ("file" or "dir"). Hidden entries (starting with '.') are excluded.

        Using explicit type info avoids the frontend having to guess whether a path
        segment is a file or a folder, which breaks when a file and a directory
        share the same name at the same level.
        """
        pod_name = self._pods.get(workspace_id)
        if not pod_name:
            return []

        try:
            # Two separate finds (files then dirs) prefixed with a type tag.
            # Prefix format: "f <abs_path>" or "d <abs_path>"
            result = await self._exec(
                pod_name,
                '( find "$1" -mindepth 1 -not -path "*/.*" -type f | sed "s|^|f |";'
                '  find "$1" -mindepth 1 -not -path "*/.*" -type d | sed "s|^|d |" ) | sort -k2',
                PROJECT_BASE_DIR,
                timeout=15,
            )
            if result.exit_code != 0:
                logger.warning("list_sandbox_files: find command returned non-zero")
                return []

            prefix = PROJECT_BASE_DIR.rstrip("/") + "/"
            entries = []
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line or " " not in line:
                    continue
                type_tag, abs_path = line.split(" ", 1)
                abs_path = abs_path.strip()
                if not abs_path.startswith(prefix):
                    continue
                rel_path = abs_path[len(prefix):]
                if not rel_path:
                    continue
                entry_type = "file" if type_tag == "f" else "dir"
                entries.append({"path": rel_path, "type": entry_type})
            return entries

        except Exception as e:
            logger.error(f"Failed to list sandbox files: {e}", exc_info=True)
            return []

    async def delete_sandbox_path(self, workspace_id: str, rel_path: str) -> Dict[str, Any]:
        """
        Delete a file or directory inside the pod under PROJECT_BASE_DIR.

        Args:
            workspace_id: Sandbox workspace id (sandbox-...)
            rel_path: Relative path under PROJECT_BASE_DIR to delete

        Returns:
            Dict with success status and optional error message
        """
        pod_name = self._pods.get(workspace_id)
        if not pod_name:
            return {"success": False, "error": "Sandbox not found"}

        # Normalize and build full path
        clean_path = rel_path.strip('/')
        if not clean_path:
            return {"success": False, "error": "Path cannot be empty"}

        full_path = f"{PROJECT_BASE_DIR}/{clean_path}"

        try:
            result = await self._exec(pod_name, 'rm -rf -- "$1"', full_path)
            if result.exit_code != 0:
                logger.error(f"delete_sandbox_path returned non-zero: {result.exit_code} {result.stderr}")
                return {"success": False, "error": f"Failed to delete path: exit {result.exit_code}"}

            logger.info(f"Deleted sandbox path: {full_path}")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to delete sandbox path {full_path}: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def get_sandbox_file_content(self, workspace_id: str, relative_path: str) -> str:
        """
        Read the content of a single file from the pod.

        Args:
            workspace_id: The workspace ID.
            relative_path: Path relative to PROJECT_BASE_DIR, e.g. "src/hello_world/package.xml".

        Returns:
            File content as a UTF-8 string.
        """
        pod_name = self._pods.get(workspace_id)
        if not pod_name:
            raise ValueError("Sandbox not found")

        abs_path = f"{PROJECT_BASE_DIR}/{relative_path.lstrip('/')}"
        content_bytes = await self._read_file(pod_name, abs_path)
        return content_bytes.decode("utf-8", errors="replace")

    # ── Interactive terminal ─────────────────────────────────────────────────

    async def open_pty(
        self,
        workspace_id: str,
        cols: int = 220,
        rows: int = 50,
    ) -> "PtySession":
        """Open an interactive bash shell (like `kubectl exec -it … bash`) in the workspace pod."""
        pod_name = self._pods.get(workspace_id)
        if not pod_name:
            raise ValueError(f"Sandbox not found: {workspace_id}")

        command = [
            "env", "TERM=xterm-256color", "COLORTERM=truecolor",
            "/bin/bash", "-c", f'cd {PROJECT_BASE_DIR} 2>/dev/null; exec /bin/bash -i',
        ]
        ws = await asyncio.to_thread(self._exec_stream, pod_name, command, stdin=True, tty=True)
        session = PtySession(ws)
        await session.resize(cols, rows)
        logger.info(f"Opened PTY for workspace {workspace_id} (pod {pod_name})")
        return session


class PtySession:
    """Async wrapper around a blocking tty exec websocket."""

    def __init__(self, ws: WSClient):
        self._ws = ws
        self._write_lock = threading.Lock()

    @property
    def is_open(self) -> bool:
        return self._ws.is_open()

    def _write(self, channel: int, data: bytes) -> None:
        with self._write_lock:
            self._ws.write_channel(channel, data)

    async def write(self, data: bytes) -> None:
        await asyncio.to_thread(self._write, 0, data)

    async def resize(self, cols: int, rows: int) -> None:
        payload = json.dumps({"Width": cols, "Height": rows}).encode()
        await asyncio.to_thread(self._write, RESIZE_CHANNEL, payload)

    def read_blocking(self, timeout: float = 1.0) -> Optional[bytes]:
        """Wait up to `timeout` for output. Returns b"" when idle, None once the shell has exited."""
        if not self._ws.is_open():
            return None
        self._ws.update(timeout=timeout)
        if self._ws.peek_stdout():
            return _as_bytes(self._ws.read_stdout(timeout=0))
        return b"" if self._ws.is_open() else None

    def close(self) -> None:
        try:
            self._ws.close()
        except Exception:
            pass


sandbox_service = SandboxService()
