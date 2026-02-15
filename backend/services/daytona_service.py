"""
Daytona Integration Service

Manages Daytona sandboxes for secure code execution using Daytona SDK.
Syncs project files into sandbox environments so users can test code
against the full project structure.
"""
import asyncio
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from core.config import settings
from schemas.daytona import (
    DaytonaWorkspaceCreate,
    DaytonaWorkspaceResponse,
    WorkspaceState,
    CodeExecutionRequest,
    CodeExecutionResponse,
)
from services.file_service import FileService

logger = logging.getLogger(__name__)

from daytona import Daytona, DaytonaConfig

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
        logger.info("✓ Daytona SDK initialized with API key")
    
    async def create_workspace(
        self,
        request: DaytonaWorkspaceCreate
    ) -> DaytonaWorkspaceResponse:
        """
        Create a new Daytona sandbox for a project via HTTP API.

        Args:
            request: Workspace creation parameters

        Returns:
            Workspace information
        """
        workspace_id = f"sandbox-{request.project_id}"

        # Check if sandbox already exists
        if workspace_id in self._sandboxes:
            logger.info(f"Reusing existing sandbox: {workspace_id}")
            return DaytonaWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=self._workspace_metadata[workspace_id]["created_at"],
                metadata=self._workspace_metadata[workspace_id],
            )

        try:
            # Create Daytona sandbox using SDK
            logger.info(f"Creating Daytona sandbox: {workspace_id}")
            sandbox = await asyncio.to_thread(self.daytona.create)
            logger.info(f"Sandbox created: {sandbox.id}, waiting for it to start...")

            # Wait for sandbox to be fully ready
            max_retries = 10
            for i in range(max_retries):
                try:
                    # Try a simple command to check if sandbox is ready
                    await asyncio.to_thread(
                        sandbox.process.exec,
                        "echo 'ready'",
                        timeout=5
                    )
                    logger.info(f"Sandbox {sandbox.id} is ready!")
                    break
                except Exception as e:
                    if i < max_retries - 1:
                        logger.info(f"Sandbox not ready yet, waiting... ({i+1}/{max_retries})")
                        await asyncio.sleep(2)
                    else:
                        logger.warning(f"Sandbox may not be fully ready: {e}")
                        # Continue anyway, it might work

            self._sandboxes[workspace_id] = sandbox

            workspace = DaytonaWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=datetime.utcnow().isoformat(),
                metadata={
                    "mode": "daytona",
                    "sandbox_id": sandbox.id,
                },
            )

            self._workspace_metadata[workspace_id] = workspace.model_dump()

            # Sync project files into the sandbox
            sync_result = await self.sync_project_files(workspace_id, request.project_id)
            workspace.files_synced = sync_result["files_synced"]
            has_errors = len(sync_result["errors"]) > 0
            if sync_result["files_synced"] > 0:
                workspace.sync_status = "partial" if has_errors else "synced"
            elif has_errors:
                workspace.sync_status = "failed"

            self._workspace_metadata[workspace_id] = workspace.model_dump()
            return workspace

        except Exception as e:
            logger.error(f"Failed to create Daytona sandbox: {e}", exc_info=True)
            raise

    async def sync_project_files(
        self,
        workspace_id: str,
        project_id: str
    ) -> Dict[str, Any]:
        """
        Sync project files from MongoDB into the sandbox filesystem via HTTP API.

        Fetches all files for the project and writes them into the sandbox
        at /home/daytona/project/, preserving directory structure.

        Returns:
            Dict with 'files_synced' count and 'errors' list
        """
        sandbox = self._sandboxes.get(workspace_id)
        if not sandbox:
            return {"files_synced": 0, "errors": ["Sandbox not found"]}

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

        # Create base project directory
        try:
            await asyncio.to_thread(sandbox.fs.create_folder, PROJECT_BASE_DIR)
            created_dirs.add(PROJECT_BASE_DIR)
        except Exception:
            pass  # may already exist

        for file_doc in files:
            try:
                file_path = file_doc.path or ""
                file_name = file_doc.name or ""
                content = file_doc.content or ""

                if not file_name:
                    continue

                # Build directory path
                if file_path and file_path != "/" and file_path != ".":
                    rel_dir = file_path.strip("/")
                    full_dir = f"{PROJECT_BASE_DIR}/{rel_dir}"
                else:
                    full_dir = PROJECT_BASE_DIR

                # Create parent directories
                if full_dir not in created_dirs:
                    parts = full_dir.replace(PROJECT_BASE_DIR, "").strip("/").split("/")
                    current = PROJECT_BASE_DIR
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

                # Write file content to sandbox (upload_file takes bytes)
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
            f"into sandbox {sandbox.id}"
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

            # Use SDK's exec method for shell commands
            response = await asyncio.to_thread(
                sandbox.process.exec,
                request.code,
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
                await asyncio.to_thread(sandbox.delete)
                logger.info(f"Stopped sandbox: {sandbox.id}")
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


daytona_service = DaytonaService()
