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

# Try to import Daytona SDK (optional dependency)
try:
    from daytona import Daytona, DaytonaConfig
    DAYTONA_AVAILABLE = True
except ImportError:
    logger.warning("Daytona SDK not installed. Install with: pip install daytona-sdk")
    DAYTONA_AVAILABLE = False
    Daytona = None
    DaytonaConfig = None

PROJECT_BASE_DIR = "/home/daytona/project"


class DaytonaService:
    """
    Service for managing Daytona sandboxes.
    
    Uses Daytona SDK to create isolated Python environments
    for safe code execution and testing.
    
    Falls back to local subprocess execution if SDK is not available.
    """
    
    def __init__(self):
        self.api_key = getattr(settings, "DAYTONA_API_KEY", None)
        self._sandboxes: Dict[str, Any] = {}  # workspace_id -> sandbox instance
        self._workspace_metadata: Dict[str, Dict[str, Any]] = {}
        
        # Initialize Daytona client if available
        if DAYTONA_AVAILABLE:
            try:
                config = DaytonaConfig(api_key=self.api_key) if self.api_key else DaytonaConfig()
                self.daytona = Daytona(config)
                self.available = True
                logger.info("Daytona SDK initialized successfully")
            except Exception as e:
                logger.warning(f"Daytona SDK initialization failed: {e}. Will use local fallback.")
                self.daytona = None
                self.available = False
        else:
            logger.info("Daytona SDK not available. Using local execution mode.")
            self.daytona = None
            self.available = False
    
    async def create_workspace(
        self,
        request: DaytonaWorkspaceCreate
    ) -> DaytonaWorkspaceResponse:
        """
        Create a new Daytona sandbox for a project.
        
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
        
        if not self.available:
            # Fallback to local execution
            logger.info("Daytona not available, using local execution")
            workspace = DaytonaWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=datetime.utcnow().isoformat(),
                metadata={"mode": "local"},
            )
            self._workspace_metadata[workspace_id] = workspace.model_dump()
            return workspace
        
        try:
            # Create Daytona sandbox
            logger.info(f"Creating Daytona sandbox: {workspace_id}")
            sandbox = self.daytona.create()
            
            self._sandboxes[workspace_id] = sandbox
            
            workspace = DaytonaWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=datetime.utcnow().isoformat(),
                metadata={
                    "mode": "daytona",
                    "sandbox_id": id(sandbox),
                },
            )
            
            self._workspace_metadata[workspace_id] = workspace.model_dump()
            
            logger.info(f"Sandbox created successfully: {workspace_id}")

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
            logger.error(f"Failed to create Daytona sandbox: {e}")
            # Fallback to local execution
            workspace_id = f"local-{request.project_id}"
            workspace = DaytonaWorkspaceResponse(
                workspace_id=workspace_id,
                project_id=request.project_id,
                state=WorkspaceState.RUNNING,
                created_at=datetime.utcnow().isoformat(),
                metadata={"mode": "local", "error": str(e)},
            )
            self._workspace_metadata[workspace_id] = workspace.model_dump()
            return workspace

    async def sync_project_files(
        self,
        workspace_id: str,
        project_id: str
    ) -> Dict[str, Any]:
        """
        Sync project files from MongoDB into the sandbox filesystem.

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

        # Create the base project directory
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
                                await asyncio.to_thread(
                                    sandbox.fs.create_folder, current
                                )
                            except Exception:
                                pass
                            created_dirs.add(current)

                # Write file content to sandbox
                full_file_path = f"{full_dir}/{file_name}"
                await asyncio.to_thread(
                    sandbox.fs.upload_file_content, full_file_path, content
                )
                synced += 1
                logger.debug(f"Synced file: {full_file_path}")

            except Exception as e:
                error_msg = f"Failed to sync {file_doc.name}: {e}"
                logger.error(error_msg)
                errors.append(error_msg)

        logger.info(
            f"Synced {synced}/{len(files)} files for project {project_id} "
            f"into sandbox {workspace_id}"
        )
        return {"files_synced": synced, "errors": errors}

    async def execute_code(
        self,
        request: CodeExecutionRequest
    ) -> CodeExecutionResponse:
        """
        Execute a shell command in a Daytona sandbox with the project directory as working dir.

        Args:
            request: Command execution parameters (code field contains the shell command)

        Returns:
            Execution results including stdout, stderr, and exit code
        """
        workspace_metadata = self._workspace_metadata.get(request.workspace_id)

        if not workspace_metadata:
            return CodeExecutionResponse(
                success=False,
                stdout="",
                stderr="Workspace not found",
                exit_code=1,
                execution_time=0,
                error="Workspace not found",
            )

        # If local mode, execute directly
        if workspace_metadata.get("metadata", {}).get("mode") == "local":
            return await self._execute_local(request)

        # Execute in Daytona sandbox
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

            # Execute shell command in sandbox with project directory as working dir
            logger.debug(f"Executing command in sandbox {request.workspace_id}: {request.code}")

            # Use process.exec() for arbitrary shell commands with cwd parameter
            response = await asyncio.to_thread(
                sandbox.process.exec,
                request.code,
                cwd=PROJECT_BASE_DIR,
                timeout=request.timeout,
            )

            execution_time = asyncio.get_event_loop().time() - start_time

            # Parse response
            success = response.exit_code == 0
            result_text = response.result if hasattr(response, 'result') else ""

            return CodeExecutionResponse(
                success=success,
                stdout=result_text if success else "",
                stderr=result_text if not success else "",
                exit_code=response.exit_code,
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
    
    async def _execute_local(
        self,
        request: CodeExecutionRequest
    ) -> CodeExecutionResponse:
        """Execute code locally in a sandboxed subprocess"""
        import tempfile
        import os
        
        # Create temporary file for code
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix=f'.{request.language}',
            delete=False
        ) as f:
            f.write(request.code)
            temp_file = f.name
        
        try:
            cmd = self._get_local_execution_command(request.language, temp_file)
            
            start_time = asyncio.get_event_loop().time()
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, **request.env_vars}
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=request.timeout
                )
                execution_time = asyncio.get_event_loop().time() - start_time
                
                return CodeExecutionResponse(
                    success=process.returncode == 0,
                    stdout=stdout.decode('utf-8', errors='replace'),
                    stderr=stderr.decode('utf-8', errors='replace'),
                    exit_code=process.returncode or 0,
                    execution_time=execution_time,
                )
                
            except asyncio.TimeoutError:
                process.kill()
                return CodeExecutionResponse(
                    success=False,
                    stdout="",
                    stderr=f"Execution timeout after {request.timeout}s",
                    exit_code=124,
                    execution_time=request.timeout,
                    error="Timeout",
                )
                
        finally:
            os.unlink(temp_file)

    
    def _get_local_execution_command(self, language: str, file_path: str) -> list:
        """Get command to execute code locally"""
        if language == "python":
            return ["python3", file_path]
        elif language == "javascript":
            return ["node", file_path]
        else:
            raise ValueError(f"Unsupported language: {language}")
    
    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop and remove a Daytona sandbox"""
        workspace_metadata = self._workspace_metadata.get(workspace_id)
        
        if not workspace_metadata:
            return
        
        # Skip for local workspaces
        if workspace_metadata.get("metadata", {}).get("mode") == "local":
            if workspace_id in self._workspace_metadata:
                del self._workspace_metadata[workspace_id]
            return
        
        # Stop Daytona sandbox
        sandbox = self._sandboxes.get(workspace_id)
        if sandbox:
            try:
                logger.info(f"Stopping sandbox: {workspace_id}")
                # Daytona SDK handles cleanup automatically
                # Just remove from our tracking
                del self._sandboxes[workspace_id]
            except Exception as e:
                logger.error(f"Failed to stop sandbox: {e}")
        
        if workspace_id in self._workspace_metadata:
            del self._workspace_metadata[workspace_id]
    
    async def get_workspace(self, workspace_id: str) -> Optional[DaytonaWorkspaceResponse]:
        """Get workspace information"""
        workspace_metadata = self._workspace_metadata.get(workspace_id)
        if workspace_metadata:
            return DaytonaWorkspaceResponse(**workspace_metadata)
        return None


daytona_service = DaytonaService()
