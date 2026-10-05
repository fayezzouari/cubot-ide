"""
API routes for Kubernetes sandbox management
Sandboxes are only available for ROS projects.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from schemas.sandbox import (
    SandboxWorkspaceCreate,
    SandboxWorkspaceResponse,
    CodeExecutionRequest,
    CodeExecutionResponse,
    SyncFilesRequest,
    SyncFilesResponse,
    SandboxFileListResponse,
    SandboxFileContentResponse,
)
from services.sandbox_service import sandbox_service
from services.project_service import ProjectService
from models.file import ProjectType

router = APIRouter(tags=["sandbox"])
logger = logging.getLogger(__name__)


@router.post("/sandbox/workspaces", response_model=SandboxWorkspaceResponse)
async def create_workspace(request: SandboxWorkspaceCreate):
    """Create a new sandbox workspace with project files synced.

    Only ROS projects have access to sandboxes.
    """
    try:
        # Verify that the project is a ROS project
        project = await ProjectService.get_project(request.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.project_type != ProjectType.ROS.value:
            raise HTTPException(
                status_code=403,
                detail="Sandboxes are only available for ROS projects"
            )

        workspace = await sandbox_service.create_workspace(request)
        return workspace
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandbox/workspaces/{workspace_id}", response_model=SandboxWorkspaceResponse)
async def get_workspace(workspace_id: str):
    """Get workspace information"""
    workspace = await sandbox_service.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


@router.delete("/sandbox/workspaces/{workspace_id}")
async def stop_workspace(workspace_id: str):
    """Stop and remove a workspace"""
    await sandbox_service.stop_workspace(workspace_id)
    return {"status": "stopped"}


@router.post("/sandbox/workspaces/{workspace_id}/sync", response_model=SyncFilesResponse)
async def sync_files(workspace_id: str, request: SyncFilesRequest):
    """Sync project files to an existing sandbox.

    Only ROS projects have access to sandboxes.
    """
    try:
        # Verify that the project is a ROS project
        project = await ProjectService.get_project(request.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.project_type != ProjectType.ROS.value:
            raise HTTPException(
                status_code=403,
                detail="Sandboxes are only available for ROS projects"
            )

        result = await sandbox_service.sync_project_files(
            workspace_id, request.project_id
        )
        has_errors = len(result["errors"]) > 0
        return SyncFilesResponse(
            sandbox_id=workspace_id,
            files_synced=result["files_synced"],
            sync_status="synced" if not has_errors else "partial",
            errors=result["errors"],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandbox/workspaces/{workspace_id}/files", response_model=SandboxFileListResponse)
async def list_sandbox_files(workspace_id: str):
    """List all files currently in the sandbox filesystem."""
    try:
        entries = await sandbox_service.list_sandbox_files(workspace_id)
        return SandboxFileListResponse(entries=entries)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandbox/workspaces/{workspace_id}/file-content", response_model=SandboxFileContentResponse)
async def get_sandbox_file_content(workspace_id: str, path: str):
    """Get the content of a single file from the sandbox."""
    try:
        content = await sandbox_service.get_sandbox_file_content(workspace_id, path)
        return SandboxFileContentResponse(path=path, content=content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sandbox/workspaces/{workspace_id}/files")
async def delete_sandbox_path(workspace_id: str, path: str):
    """Delete a file or directory inside a sandbox workspace (recursive)."""
    try:
        result = await sandbox_service.delete_sandbox_path(workspace_id, path)
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to delete path"))
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sandbox/execute", response_model=CodeExecutionResponse)
async def execute_code(request: CodeExecutionRequest):
    """Execute code in a sandbox workspace"""
    try:
        result = await sandbox_service.execute_code(request)
        return result
    except Exception as e:
        logger.error(f"Code execution failed for workspace {request.workspace_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/pty/{workspace_id}")
async def pty_terminal(websocket: WebSocket, workspace_id: str):
    """
    WebSocket PTY terminal proxy for sandbox pods (an interactive `kubectl exec -it`).

    Proxies an interactive shell in the pod bidirectionally:
      - Client → Backend: raw keyboard input (text), or JSON {"type":"resize","cols":N,"rows":N}
      - Backend → Client: raw PTY output bytes (ANSI terminal sequences)
    """
    await websocket.accept()

    try:
        pty = await sandbox_service.open_pty(workspace_id)
    except Exception as e:
        error_msg = f"\r\n\x1b[31m[PTY Error: {e}]\x1b[0m\r\n"
        await websocket.send_bytes(error_msg.encode())
        await websocket.close()
        return

    logger.info(f"PTY proxy open — workspace={workspace_id}")
    loop = asyncio.get_running_loop()

    async def client_to_pty() -> None:
        """Forward client input to the pod shell."""
        try:
            async for text in websocket.iter_text():
                # Check for resize control message
                try:
                    msg = json.loads(text)
                    if isinstance(msg, dict) and msg.get("type") == "resize":
                        await pty.resize(int(msg.get("cols", 80)), int(msg.get("rows", 24)))
                        continue
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass
                # Forward raw keyboard input to PTY
                await pty.write(text.encode("utf-8"))
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.debug(f"client_to_pty ended: {exc}")
        finally:
            pty.close()

    def pty_to_client() -> None:
        """Forward shell output to the browser client. Runs in a thread (blocking reads)."""
        try:
            while True:
                data = pty.read_blocking(timeout=1.0)
                if data is None:
                    break
                if data:
                    asyncio.run_coroutine_threadsafe(websocket.send_bytes(data), loop).result()
        except Exception as exc:
            logger.debug(f"pty_to_client ended: {exc}")
        finally:
            # Shell exited (e.g. user typed `exit`): close the browser socket so client_to_pty unblocks
            asyncio.run_coroutine_threadsafe(_close_quietly(websocket), loop)

    try:
        await asyncio.gather(client_to_pty(), asyncio.to_thread(pty_to_client), return_exceptions=True)
    except Exception as e:
        logger.error(f"PTY proxy error workspace={workspace_id}: {e}", exc_info=True)
    finally:
        pty.close()
        logger.info(f"PTY proxy closed — workspace={workspace_id}")


async def _close_quietly(websocket: WebSocket) -> None:
    try:
        await websocket.close()
    except Exception:
        pass
