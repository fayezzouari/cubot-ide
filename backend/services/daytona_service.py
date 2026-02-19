"""
Daytona Integration Service

Manages Daytona sandboxes for secure code execution using Daytona SDK.
Syncs project files into sandbox environments so users can test code
against the full project structure.
"""
import asyncio
import logging
import re
import uuid
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from daytona import (
    Daytona,
    DaytonaConfig,
    CreateSandboxBaseParams,
    CreateSandboxFromSnapshotParams,
    CreateSandboxFromImageParams,
)

from core.config import settings
from schemas.daytona import (
    DaytonaWorkspaceCreate,
    DaytonaWorkspaceResponse,
    WorkspaceState,
    CodeExecutionRequest,
    CodeExecutionResponse,
)
from services.file_service import FileService
from services.project_service import project_service

logger = logging.getLogger(__name__)


PROJECT_BASE_DIR = "/home/daytona/project"


class DaytonaService:
    """
    Service for managing Daytona sandboxes.

    Uses Daytona REST API to create isolated sandbox environments
    for safe code execution and testing.
    """

    def __init__(self):
        self.api_key = getattr(settings, "DAYTONA_API_KEY", None)
        self._sandboxes: Dict[str, Any] = {}  # workspace_id -> sandbox instance
        self._workspace_metadata: Dict[str, Dict[str, Any]] = {}

        # Initialize Daytona client
        config = DaytonaConfig(api_key=self.api_key)
        self.daytona = Daytona(config)
        logger.info("✓ Daytona SDK initialized")

    async def _test_sandbox_connection(self, sandbox: Any, timeout: int = 5) -> bool:
        """Test if a sandbox is responsive by running a simple command."""
        try:
            await asyncio.to_thread(
                sandbox.process.exec,
                "echo 'test'",
                timeout=timeout
            )
            return True
        except Exception:
            return False

    async def _wait_for_sandbox_ready(self, sandbox: Any, max_retries: int = 10) -> bool:
        """Wait for sandbox to be fully ready."""
        for i in range(max_retries):
            if await self._test_sandbox_connection(sandbox):
                logger.info(f"Sandbox {sandbox.id} is ready!")
                return True
            if i < max_retries - 1:
                logger.info(f"Sandbox not ready yet, waiting... ({i+1}/{max_retries})")
                await asyncio.sleep(2)
        logger.warning(f"Sandbox may not be fully ready after {max_retries} attempts")
        return False

    def _create_workspace_response(
        self,
        workspace_id: str,
        project_id: str,
        sandbox: Any
    ) -> DaytonaWorkspaceResponse:
        """Create a DaytonaWorkspaceResponse object."""
        return DaytonaWorkspaceResponse(
            workspace_id=workspace_id,
            project_id=project_id,
            state=WorkspaceState.RUNNING,
            created_at=datetime.now(timezone.utc).isoformat(),
            metadata={
                "mode": "daytona",
                "sandbox_id": sandbox.id,
            },
        )

    async def _sync_and_finalize_workspace(
        self,
        workspace: DaytonaWorkspaceResponse,
        workspace_id: str,
        project_id: str
    ) -> DaytonaWorkspaceResponse:
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

    async def _delete_sandbox_by_name(self, sandbox_name: str, saved_sandbox_id: Optional[str] = None) -> bool:
        """
        Delete a sandbox by name. Returns True if successful.

        Tries multiple approaches:
        1. Delete by saved_sandbox_id if available
        2. List all sandboxes and find by name
        """
        # Approach 1: Use saved_sandbox_id if available
        if saved_sandbox_id:
            try:
                logger.info(f"Attempting to delete sandbox by ID: {saved_sandbox_id}")
                old_sandbox = await asyncio.to_thread(self.daytona.get, saved_sandbox_id)
                await asyncio.to_thread(old_sandbox.delete)
                logger.info(f"Successfully deleted sandbox {saved_sandbox_id}")
                return True
            except Exception as e:
                logger.warning(f"Could not delete by ID {saved_sandbox_id}: {e}")

        # Approach 2: List all sandboxes and find by name
        try:
            logger.info("Listing all sandboxes to find and delete by name...")
            paginated_sandboxes = await asyncio.to_thread(self.daytona.list)
            sandboxes = getattr(paginated_sandboxes, 'items', None) or getattr(paginated_sandboxes, 'data', None) or []
            logger.info(f"Found {len(sandboxes)} sandboxes")

            for sb in sandboxes:
                sb_name = getattr(sb, 'name', None)
                if sb_name == sandbox_name:
                    sb_id = getattr(sb, 'id', None)
                    logger.info(f"Found sandbox with matching name: {sb_id}")
                    await asyncio.to_thread(sb.delete)
                    logger.info(f"Successfully deleted sandbox {sb_id}")
                    return True

            logger.warning(f"No sandbox found with name {sandbox_name}")
        except Exception as e:
            logger.error(f"Could not list/delete sandboxes: {e}", exc_info=True)

        return False
    
    async def create_workspace(
        self,
        request: DaytonaWorkspaceCreate
    ) -> DaytonaWorkspaceResponse:
        """
        Create a new Daytona sandbox for a project.

        Workflow:
        1. Check if sandbox exists in memory (fast path)
        2. Try to reconnect to saved sandbox from database
        3. If reconnect fails, try to start the stopped sandbox
        4. If all fails, create a new sandbox

        Args:
            request: Workspace creation parameters

        Returns:
            Workspace information with sync status
        """
        workspace_id = f"sandbox-{request.project_id}"

        # Fast path: Reuse existing sandbox from memory
        if workspace_id in self._sandboxes:
            logger.info(f"Reusing existing sandbox from memory: {workspace_id}")
            return DaytonaWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=self._workspace_metadata[workspace_id]["created_at"],
                metadata=self._workspace_metadata[workspace_id],
            )

        # Try to reconnect to existing sandbox
        saved_sandbox_id = await project_service.get_sandbox_id(request.project_id)
        if saved_sandbox_id:
            workspace = await self._try_reconnect_sandbox(
                workspace_id, request.project_id, saved_sandbox_id
            )
            if workspace:
                return workspace

        # Create new sandbox
        return await self._create_new_sandbox(workspace_id, request.project_id, saved_sandbox_id)

    async def _try_reconnect_sandbox(
        self,
        workspace_id: str,
        project_id: str,
        saved_sandbox_id: str
    ) -> Optional[DaytonaWorkspaceResponse]:
        """
        Try to reconnect to an existing sandbox. If it's stopped, try to start it.

        Returns:
            Workspace response if successful, None otherwise
        """
        logger.info(f"Found saved sandbox ID for project {project_id}: {saved_sandbox_id}")

        try:
            # Try to reconnect to the existing sandbox
            sandbox = await asyncio.to_thread(self.daytona.get, saved_sandbox_id)

            if await self._test_sandbox_connection(sandbox):
                logger.info(f"Successfully reconnected to existing sandbox: {saved_sandbox_id}")
                return await self._finalize_sandbox_connection(
                    workspace_id, project_id, sandbox
                )

            # Sandbox exists but not responsive - try to start it
            logger.info(f"Sandbox {saved_sandbox_id} is not responsive, attempting to start it")
            await asyncio.to_thread(sandbox.start, 60)
            logger.info(f"Successfully started sandbox {saved_sandbox_id}")

            if await self._test_sandbox_connection(sandbox):
                logger.info(f"Sandbox {saved_sandbox_id} is now running!")
                return await self._finalize_sandbox_connection(
                    workspace_id, project_id, sandbox
                )

        except Exception as e:
            logger.warning(f"Failed to reconnect/start sandbox {saved_sandbox_id}: {e}")
            await project_service.update_sandbox_id(project_id, None)

        return None

    async def _finalize_sandbox_connection(
        self,
        workspace_id: str,
        project_id: str,
        sandbox: Any
    ) -> DaytonaWorkspaceResponse:
        """Store sandbox in memory, sync files, and return workspace response."""
        self._sandboxes[workspace_id] = sandbox
        workspace = self._create_workspace_response(workspace_id, project_id, sandbox)
        self._workspace_metadata[workspace_id] = workspace.model_dump()
        return await self._sync_and_finalize_workspace(workspace, workspace_id, project_id)

    def _build_ros_sandbox_params(self, sandbox_name: str) -> CreateSandboxBaseParams:
        """
        Build sandbox creation params using a Daytona ROS Humble snapshot if configured,
        otherwise fall back to the official ROS Humble Docker image.
        """
        ros_snapshot = getattr(settings, "DAYTONA_ROS_SNAPSHOT", None)

        if ros_snapshot:
            logger.info(f"Using Daytona ROS snapshot: {ros_snapshot}")
            return CreateSandboxFromSnapshotParams(
                name=sandbox_name,
                snapshot=ros_snapshot,
                env_vars={
                    "ROS_DISTRO": "humble",
                    "ROS_VERSION": "2",
                    "ROS_PYTHON_VERSION": "3",
                    "DEBIAN_FRONTEND": "noninteractive",
                    "LANG": "en_US.UTF-8",
                },
                auto_stop_interval=0,
            )

        # Fall back to the official ROS Humble base image
        logger.info("No ROS snapshot configured, using osrf/ros:humble-ros-base image")
        return CreateSandboxFromImageParams(
            name=sandbox_name,
            image="ros:humble-ros-base",
            env_vars={
                "ROS_DISTRO": "humble",
                "ROS_VERSION": "2",
                "ROS_PYTHON_VERSION": "3",
                "DEBIAN_FRONTEND": "noninteractive",
                "LANG": "en_US.UTF-8",
            },
            auto_stop_interval=0,
        )

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

    async def _setup_ros_workspace(self, sandbox: Any, pkg_name: str) -> None:
        """
        Initialize the ROS 2 workspace inside the sandbox after creation.

        Creates a full ament_python package structure under src/<pkg_name>/:
          package.xml, setup.py, setup.cfg, resource/<pkg_name>, <pkg_name>/__init__.py

        Also sources ROS into .bashrc for interactive shells.
        rosdep update is intentionally omitted (slow network call).
        """
        logger.info(f"Setting up ROS workspace for package '{pkg_name}'...")

        pkg_dir = f"{PROJECT_BASE_DIR}/src/{pkg_name}"
        py_dir = f"{pkg_dir}/{pkg_name}"
        resource_dir = f"{pkg_dir}/resource"

        package_xml = (
            f'<?xml version="1.0"?>\\n'
            f'<package format="3">\\n'
            f'  <name>{pkg_name}</name>\\n'
            f'  <version>0.0.1</version>\\n'
            f'  <description>{pkg_name} ROS 2 package</description>\\n'
            f'  <maintainer email="user@example.com">user</maintainer>\\n'
            f'  <license>Apache-2.0</license>\\n'
            f'  <exec_depend>rclpy</exec_depend>\\n'
            f'  <export>\\n'
            f'    <build_type>ament_python</build_type>\\n'
            f'  </export>\\n'
            f'</package>'
        )

        setup_py = (
            f"from setuptools import setup\\n\\n"
            f"package_name = '{pkg_name}'\\n\\n"
            f"setup(\\n"
            f"    name=package_name,\\n"
            f"    version='0.0.1',\\n"
            f"    packages=[package_name],\\n"
            f"    data_files=[\\n"
            f"        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),\\n"
            f"        ('share/' + package_name, ['package.xml']),\\n"
            f"    ],\\n"
            f"    install_requires=['setuptools'],\\n"
            f"    zip_safe=True,\\n"
            f"    entry_points={{\\n"
            f"        'console_scripts': [],\\n"
            f"    }},\\n"
            f")"
        )

        setup_cfg = "[develop]\\nscript_dir=$base/lib/{pkg_name}\\n[install]\\ninstall_scripts=$base/lib/{pkg_name}".format(pkg_name=pkg_name)

        setup_script = (
            f"source /opt/ros/humble/setup.bash"
            f" && mkdir -p {py_dir} {resource_dir}"
            f" && printf '%s' '{package_xml}' > {pkg_dir}/package.xml"
            f" && printf '%s' '{setup_py}' > {pkg_dir}/setup.py"
            f" && printf '%s' '{setup_cfg}' > {pkg_dir}/setup.cfg"
            f" && touch {resource_dir}/{pkg_name}"
            f" && touch {py_dir}/__init__.py"
            # Write to system-wide locations so it works for root (PTY user) and any login shell.
            f" && (grep -qxF 'source /opt/ros/humble/setup.bash' /etc/bash.bashrc"
            f" || echo 'source /opt/ros/humble/setup.bash' >> /etc/bash.bashrc)"
            f" && (grep -qxF 'source /opt/ros/humble/setup.bash' /root/.bashrc"
            f" || echo 'source /opt/ros/humble/setup.bash' >> /root/.bashrc)"
            f" && printf '#!/bin/bash\\nsource /opt/ros/humble/setup.bash\\n'"
            f" > /etc/profile.d/ros-humble.sh && chmod +x /etc/profile.d/ros-humble.sh"
        )

        try:
            result = await asyncio.to_thread(
                sandbox.process.exec,
                f"/bin/bash -c '{setup_script}'",
                timeout=30,
            )
            if result.exit_code != 0:
                logger.warning(f"ROS workspace setup returned non-zero exit code")
            else:
                logger.info(f"✓ ROS package '{pkg_name}' scaffold created")
        except Exception as e:
            logger.warning(f"ROS workspace setup failed (non-fatal): {e}")

    async def _create_new_sandbox(
        self,
        workspace_id: str,
        project_id: str,
        saved_sandbox_id: Optional[str]
    ) -> DaytonaWorkspaceResponse:
        """Create a new Daytona ROS Humble sandbox with automatic cleanup on name conflicts."""
        logger.info(f"Creating new ROS Humble sandbox for project: {project_id}")

        # Derive ROS package name from project name
        project = await project_service.get_project(project_id)
        pkg_name = self._ros_package_name(project.name) if project else "ros_project"
        logger.info(f"ROS package name: '{pkg_name}'")

        sandbox_name = f"ros-project-{project_id[:8]}"
        params = self._build_ros_sandbox_params(sandbox_name)

        try:
            sandbox = await asyncio.to_thread(self.daytona.create, params)
        except Exception as create_error:
            # Handle name conflicts by cleaning up old sandbox
            if "already exists" in str(create_error):
                logger.warning(f"Sandbox '{sandbox_name}' already exists, attempting cleanup...")

                if await self._delete_sandbox_by_name(sandbox_name, saved_sandbox_id):
                    logger.info("Retrying sandbox creation after cleanup...")
                    await asyncio.sleep(2)  # Give it time to fully clean up
                    try:
                        sandbox = await asyncio.to_thread(self.daytona.create, params)
                        logger.info("Successfully created sandbox after cleanup")
                    except Exception as retry_error:
                        logger.error(f"Sandbox creation failed on retry: {retry_error}", exc_info=True)
                        raise retry_error
                else:
                    logger.error("Could not delete existing sandbox, cannot proceed")
                    raise create_error
            else:
                logger.error(f"Sandbox creation failed: {create_error}", exc_info=True)
                raise

        # Wait for sandbox to be ready
        logger.info(f"Sandbox created: {sandbox.id}, waiting for it to start...")
        await self._wait_for_sandbox_ready(sandbox)

        # Initialize ROS package structure
        await self._setup_ros_workspace(sandbox, pkg_name)

        # Save sandbox ID and pkg_name to database / metadata
        await project_service.update_sandbox_id(project_id, sandbox.id)
        logger.info(f"Saved sandbox ID {sandbox.id} to project {project_id}")

        # Store pkg_name in metadata so sync can use it
        self._workspace_metadata.setdefault(workspace_id, {})["pkg_name"] = pkg_name

        # Finalize and return
        return await self._finalize_sandbox_connection(workspace_id, project_id, sandbox)

    async def sync_project_files(
        self,
        workspace_id: str,
        project_id: str
    ) -> Dict[str, Any]:
        """
        Sync project files from MongoDB into the sandbox filesystem.

        Files are placed inside the ROS package Python module directory:
          src/<pkg_name>/<pkg_name>/<file>
        so they are importable by the package and picked up by colcon.

        Falls back to PROJECT_BASE_DIR if no pkg_name is recorded (legacy/non-ROS).
        """
        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
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
        created_dirs: set = set()

        # Ensure sync root exists
        try:
            await asyncio.to_thread(sandbox.fs.create_folder, sync_root)
            created_dirs.add(sync_root)
        except Exception:
            pass  # may already exist

        for file_doc in files:
            try:
                file_path = file_doc.path or ""
                file_name = file_doc.name or ""
                content = file_doc.content or ""

                if not file_name:
                    continue

                # Build directory path relative to sync_root
                if file_path and file_path not in ("/", "."):
                    rel_dir = file_path.strip("/")
                    full_dir = f"{sync_root}/{rel_dir}"
                else:
                    full_dir = sync_root

                # Create parent directories
                if full_dir not in created_dirs:
                    parts = full_dir.replace(sync_root, "").strip("/").split("/")
                    current = sync_root
                    for part in parts:
                        if not part:
                            continue
                        current = f"{current}/{part}"
                        if current not in created_dirs:
                            try:
                                await asyncio.to_thread(sandbox.fs.create_folder, current)
                            except Exception:
                                pass
                            created_dirs.add(current)

                # Write file to sandbox
                full_file_path = f"{full_dir}/{file_name}"
                content_bytes = content.encode('utf-8')
                await asyncio.to_thread(
                    sandbox.fs.upload_file, content_bytes, full_file_path
                )
                synced += 1
                logger.debug(f"Synced file: {full_file_path}")

            except Exception as e:
                error_msg = f"Failed to sync {file_doc.name}: {e}"
                logger.error(error_msg)
                errors.append(error_msg)

        logger.info(
            f"Synced {synced}/{len(files)} files for project {project_id} "
            f"into {sync_root} (sandbox {sandbox.id})"
        )
        return {"files_synced": synced, "errors": errors}

    async def execute_code(
        self,
        request: CodeExecutionRequest
    ) -> CodeExecutionResponse:
        """
        Execute a shell command in a Daytona sandbox via HTTP API.

        Args:
            request: Command execution parameters (code field contains the shell command)

        Returns:
            Execution results including stdout, stderr, and exit code
        """
        # Execute in Daytona sandbox using SDK
        sandbox = self._sandboxes.get(request.workspace_id)
        if not sandbox:
            return CodeExecutionResponse(
                success=False,
                stdout="",
                stderr="Sandbox not found",
                exit_code=1,
                execution_time=0,
                error="Sandbox not found",
            )

        try:
            start_time = asyncio.get_event_loop().time()

            logger.debug(f"Executing command in sandbox {sandbox.id}: {request.code}")

            # Check if ROS is installed, if so source it
            # Otherwise just run the command directly
            wrapped_command = f'/bin/bash -c "if [ -f /opt/ros/humble/setup.bash ]; then source /opt/ros/humble/setup.bash; fi && {request.code}"'

            # Use SDK's exec method for shell commands
            response = await asyncio.to_thread(
                sandbox.process.exec,
                wrapped_command,
                cwd=PROJECT_BASE_DIR,
                timeout=request.timeout or 30,
            )

            execution_time = asyncio.get_event_loop().time() - start_time

            exit_code = response.exit_code
            success = exit_code == 0
            result_text = response.result if hasattr(response, 'result') else ""

            logger.debug(f"Command response: exit_code={exit_code}, result_len={len(result_text)}")

            return CodeExecutionResponse(
                success=success,
                stdout=result_text if success else "",
                stderr=result_text if not success else "",
                exit_code=exit_code,
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
        """Stop and remove a Daytona sandbox via HTTP API"""
        # Stop Daytona sandbox using SDK
        sandbox = self._sandboxes.get(workspace_id)
        if sandbox:
            try:
                # Extract project_id from workspace_id (format: "sandbox-{project_id}")
                project_id = workspace_id.replace("sandbox-", "")

                # Delete the sandbox
                await asyncio.to_thread(sandbox.delete)
                logger.info(f"Stopped sandbox: {sandbox.id}")

                # Clear sandbox_id from database
                await project_service.update_sandbox_id(project_id, None)
                logger.info(f"Cleared sandbox ID from project {project_id}")

            except Exception as e:
                logger.error(f"Failed to stop sandbox: {e}")

            if workspace_id in self._sandboxes:
                del self._sandboxes[workspace_id]

        if workspace_id in self._workspace_metadata:
            del self._workspace_metadata[workspace_id]
    
    async def get_workspace(self, workspace_id: str) -> Optional[DaytonaWorkspaceResponse]:
        """Get workspace information"""
        workspace_metadata = self._workspace_metadata.get(workspace_id)
        if workspace_metadata:
            return DaytonaWorkspaceResponse(**workspace_metadata)
        return None

    def _get_workspace_by_project(self, project_id: str) -> Optional[str]:
        """Find workspace ID by project ID"""
        for workspace_id, metadata in self._workspace_metadata.items():
            if metadata.get("project_id") == project_id:
                return workspace_id
        return None

    async def sync_file_add(
        self,
        project_id: str,
        file_path: str,
        file_name: str,
        content: str
    ) -> Dict[str, Any]:
        """
        Sync a newly added file to the Daytona sandbox.

        Args:
            project_id: Project ID
            file_path: Directory path for the file
            file_name: Name of the file
            content: File content

        Returns:
            Dict with success status and any error message
        """
        workspace_id = self._get_workspace_by_project(project_id)
        if not workspace_id:
            return {"success": False, "error": "No active workspace for project"}

        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return {"success": False, "error": "Sandbox not found"}

        try:
            # Build full path
            if file_path and file_path != "/" and file_path != ".":
                rel_dir = file_path.strip("/")
                full_dir = f"{PROJECT_BASE_DIR}/{rel_dir}"
            else:
                full_dir = PROJECT_BASE_DIR

            # Ensure directory exists
            try:
                await asyncio.to_thread(sandbox.fs.create_folder, full_dir)
            except Exception:
                pass  # Directory may already exist

            # Upload file
            full_file_path = f"{full_dir}/{file_name}"
            content_bytes = content.encode('utf-8')
            await asyncio.to_thread(
                sandbox.fs.upload_file, content_bytes, full_file_path
            )

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
        Sync file content update to the Daytona sandbox.

        Args:
            project_id: Project ID
            file_path: Directory path for the file
            file_name: Name of the file
            content: Updated file content

        Returns:
            Dict with success status and any error message
        """
        # For updates, we can reuse the add logic since upload_file overwrites
        return await self.sync_file_add(project_id, file_path, file_name, content)

    async def sync_file_delete(
        self,
        project_id: str,
        file_path: str,
        file_name: str
    ) -> Dict[str, Any]:
        """
        Sync file deletion to the Daytona sandbox.

        Args:
            project_id: Project ID
            file_path: Directory path for the file
            file_name: Name of the file

        Returns:
            Dict with success status and any error message
        """
        workspace_id = self._get_workspace_by_project(project_id)
        if not workspace_id:
            return {"success": False, "error": "No active workspace for project"}

        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return {"success": False, "error": "Sandbox not found"}

        try:
            # Build full path
            if file_path and file_path != "/" and file_path != ".":
                rel_dir = file_path.strip("/")
                full_file_path = f"{PROJECT_BASE_DIR}/{rel_dir}/{file_name}"
            else:
                full_file_path = f"{PROJECT_BASE_DIR}/{file_name}"

            # Delete file using SDK
            await asyncio.to_thread(sandbox.fs.delete_file, full_file_path)

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
        Sync file rename/move to the Daytona sandbox.

        Args:
            project_id: Project ID
            old_path: Original directory path
            old_name: Original file name
            new_path: New directory path
            new_name: New file name

        Returns:
            Dict with success status and any error message
        """
        workspace_id = self._get_workspace_by_project(project_id)
        if not workspace_id:
            return {"success": False, "error": "No active workspace for project"}

        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return {"success": False, "error": "Sandbox not found"}

        try:
            # Build old and new full paths
            if old_path and old_path != "/" and old_path != ".":
                old_rel_dir = old_path.strip("/")
                old_full_path = f"{PROJECT_BASE_DIR}/{old_rel_dir}/{old_name}"
            else:
                old_full_path = f"{PROJECT_BASE_DIR}/{old_name}"

            if new_path and new_path != "/" and new_path != ".":
                new_rel_dir = new_path.strip("/")
                new_full_dir = f"{PROJECT_BASE_DIR}/{new_rel_dir}"
                new_full_path = f"{new_full_dir}/{new_name}"
            else:
                new_full_dir = PROJECT_BASE_DIR
                new_full_path = f"{PROJECT_BASE_DIR}/{new_name}"

            # Ensure new directory exists
            try:
                await asyncio.to_thread(sandbox.fs.create_folder, new_full_dir)
            except Exception:
                pass  # Directory may already exist

            # Move/rename file - read content from old location and write to new
            content_bytes = await asyncio.to_thread(
                sandbox.fs.download_file, old_full_path
            )
            await asyncio.to_thread(
                sandbox.fs.upload_file, content_bytes, new_full_path
            )
            await asyncio.to_thread(sandbox.fs.delete_file, old_full_path)

            logger.info(f"Renamed file in sandbox: {old_full_path} -> {new_full_path}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Failed to sync file rename: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def list_sandbox_files(self, workspace_id: str) -> List[str]:
        """
        List all entries (files AND directories) in the sandbox under PROJECT_BASE_DIR.

        Returns a list of dicts with 'path' (relative to PROJECT_BASE_DIR) and
        'type' ("file" or "dir"). Hidden entries (starting with '.') are excluded.

        Using explicit type info avoids the frontend having to guess whether a path
        segment is a file or a folder, which breaks when a file and a directory
        share the same name at the same level.
        """
        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return []

        try:
            # Two separate finds (files then dirs) prefixed with a type tag.
            # Avoids -printf which is GNU find-specific and may not be available.
            # Prefix format: "f <abs_path>" or "d <abs_path>"
            cmd = (
                f"("
                f"find {PROJECT_BASE_DIR} -mindepth 1 -not -path '*/.*' -type f | sed 's|^|f |';"
                f"find {PROJECT_BASE_DIR} -mindepth 1 -not -path '*/.*' -type d | sed 's|^|d |'"
                f") | sort -k2"
            )
            result = await asyncio.to_thread(
                sandbox.process.exec,
                f"/bin/bash -c '{cmd}'",
                timeout=15,
            )
            if result.exit_code != 0:
                logger.warning("list_sandbox_files: find command returned non-zero")
                return []

            prefix = PROJECT_BASE_DIR.rstrip("/") + "/"
            entries = []
            for line in (result.result or "").splitlines():
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

    async def get_sandbox_file_content(self, workspace_id: str, relative_path: str) -> str:
        """
        Download the content of a single file from the sandbox.

        Args:
            workspace_id: The workspace ID.
            relative_path: Path relative to PROJECT_BASE_DIR, e.g. "src/hello_world/package.xml".

        Returns:
            File content as a UTF-8 string.
        """
        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            raise ValueError("Sandbox not found")

        abs_path = f"{PROJECT_BASE_DIR}/{relative_path.lstrip('/')}"
        content_bytes: bytes = await asyncio.to_thread(
            sandbox.fs.download_file, abs_path
        )
        return content_bytes.decode("utf-8", errors="replace")

    async def create_pty_session(
        self,
        workspace_id: str,
        cols: int = 220,
        rows: int = 50,
    ) -> Dict[str, Any]:
        """
        Create a PTY session in the sandbox and return WebSocket connection info.

        Returns:
            Dict with session_id, ws_url, ws_headers for connecting to the PTY.
        """
        from daytona_toolbox_api_client import PtyCreateRequest

        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            raise ValueError(f"Sandbox not found: {workspace_id}")

        session_id = f"pty-{uuid.uuid4().hex[:8]}"

        def _setup_pty():
            # Ensure the toolbox URL is initialised (blocking)
            sandbox.process._ensure_toolbox_url()

            # Guarantee ROS is sourced in every shell type and for every user.
            # The PTY runs as root so ~/.bashrc = /root/.bashrc, not /home/daytona/.bashrc.
            # Ubuntu-patched bash also auto-sources /etc/bash.bashrc for interactive
            # non-login shells, and /etc/profile.d/*.sh is sourced for login shells.
            sandbox.process.exec(
                "/bin/bash -c '"
                "ROS_LINE=\"source /opt/ros/humble/setup.bash\"; "
                "grep -qxF \"$ROS_LINE\" /etc/bash.bashrc   || echo \"$ROS_LINE\" >> /etc/bash.bashrc; "
                "grep -qxF \"$ROS_LINE\" /root/.bashrc      || echo \"$ROS_LINE\" >> /root/.bashrc; "
                "printf \"#!/bin/bash\\n$ROS_LINE\\n\" > /etc/profile.d/ros-humble.sh; "
                "chmod +x /etc/profile.d/ros-humble.sh"
                "'",
                timeout=5,
            )

            # Create the PTY session via the toolbox API
            response = sandbox.process._api_client.create_pty_session(
                request=PtyCreateRequest(
                    id=session_id,
                    cwd=PROJECT_BASE_DIR,
                    envs={
                        "TERM": "xterm-256color",
                        "COLORTERM": "truecolor",
                        "ROS_DISTRO": "humble",
                        "ROS_VERSION": "2",
                        "ROS_PYTHON_VERSION": "3",
                    },
                    cols=cols,
                    rows=rows,
                    lazy_start=True,
                )
            )

            # Serialise the WebSocket URL and auth headers (pure URL building, no I/O)
            _, url, headers, *_ = sandbox.process._api_client._connect_pty_session_serialize(
                session_id=response.session_id,
                _request_auth=None,
                _content_type=None,
                _headers=None,
                _host_index=None,
            )
            ws_url = re.sub(r"^http", "ws", url)
            return response.session_id, ws_url, dict(headers)

        actual_session_id, ws_url, ws_headers = await asyncio.to_thread(_setup_pty)
        logger.info(f"Created PTY session {actual_session_id} for workspace {workspace_id}")

        return {
            "session_id": actual_session_id,
            "ws_url": ws_url,
            "ws_headers": ws_headers,
        }

    async def resize_pty_session(
        self,
        workspace_id: str,
        session_id: str,
        cols: int,
        rows: int,
    ) -> None:
        """Resize a PTY session to the given terminal dimensions."""
        from daytona_toolbox_api_client import PtyResizeRequest

        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return

        await asyncio.to_thread(
            sandbox.process._api_client.resize_pty_session,
            session_id=session_id,
            request=PtyResizeRequest(cols=cols, rows=rows),
        )

    async def kill_pty_session(self, workspace_id: str, session_id: str) -> None:
        """Kill and clean up a PTY session."""
        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return

        try:
            await asyncio.to_thread(
                sandbox.process._api_client.delete_pty_session,
                session_id=session_id,
            )
            logger.info(f"Killed PTY session {session_id}")
        except Exception as e:
            logger.warning(f"Failed to kill PTY session {session_id}: {e}")


daytona_service = DaytonaService()
