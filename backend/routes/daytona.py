"""
API routes for Daytona workspace management
Daytona sandboxes are only available for ROS projects.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
import websockets as ext_ws

from schemas.daytona import (
    DaytonaWorkspaceCreate,
    DaytonaWorkspaceResponse,
    CodeExecutionRequest,
    CodeExecutionResponse,
    SyncFilesRequest,
    SyncFilesResponse,
    SandboxFileListResponse,
    SandboxFileContentResponse,
)
from services.daytona_service import daytona_service
from services.project_service import ProjectService
from models.file import ProjectType

router = APIRouter(tags=["daytona"])
logger = logging.getLogger(__name__)


@router.post("/daytona/workspaces", response_model=DaytonaWorkspaceResponse)
async def create_workspace(request: DaytonaWorkspaceCreate):
    """Create a new Daytona workspace with project files synced.

    Only ROS projects have access to Daytona sandboxes.
    """
    try:
        # Verify that the project is a ROS project
        project = await ProjectService.get_project(request.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.project_type != ProjectType.ROS.value:
            raise HTTPException(
                status_code=403,
                detail="Daytona sandboxes are only available for ROS projects"
            )

        workspace = await daytona_service.create_workspace(request)
        return workspace
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daytona/workspaces/{workspace_id}", response_model=DaytonaWorkspaceResponse)
async def get_workspace(workspace_id: str):
    """Get workspace information"""
    workspace = await daytona_service.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


@router.delete("/daytona/workspaces/{workspace_id}")
async def stop_workspace(workspace_id: str):
    """Stop and remove a workspace"""
    await daytona_service.stop_workspace(workspace_id)
    return {"status": "stopped"}


@router.post("/daytona/workspaces/{workspace_id}/sync", response_model=SyncFilesResponse)
async def sync_files(workspace_id: str, request: SyncFilesRequest):
    """Sync project files to an existing sandbox.

    Only ROS projects have access to Daytona sandboxes.
    """
    try:
        # Verify that the project is a ROS project
        project = await ProjectService.get_project(request.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.project_type != ProjectType.ROS.value:
            raise HTTPException(
                status_code=403,
                detail="Daytona sandboxes are only available for ROS projects"
            )

        result = await daytona_service.sync_project_files(
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


@router.get("/daytona/workspaces/{workspace_id}/files", response_model=SandboxFileListResponse)
async def list_sandbox_files(workspace_id: str):
    """List all files currently in the sandbox filesystem."""
    try:
        entries = await daytona_service.list_sandbox_files(workspace_id)
        return SandboxFileListResponse(entries=entries)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daytona/workspaces/{workspace_id}/file-content", response_model=SandboxFileContentResponse)
async def get_sandbox_file_content(workspace_id: str, path: str):
    """Get the content of a single file from the sandbox."""
    try:
        content = await daytona_service.get_sandbox_file_content(workspace_id, path)
        return SandboxFileContentResponse(path=path, content=content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/daytona/execute", response_model=CodeExecutionResponse)
async def execute_code(request: CodeExecutionRequest):
    """Execute code in a Daytona workspace"""
    try:
        result = await daytona_service.execute_code(request)
        return result
    except Exception as e:
        logger.error(f"Code execution failed for workspace {request.workspace_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/pty/{workspace_id}")
async def pty_terminal(websocket: WebSocket, workspace_id: str):
    """
    WebSocket PTY terminal proxy for Daytona sandboxes.

    Opens an interactive PTY session in the sandbox and proxies it bidirectionally:
      - Client → Backend: raw keyboard input (text), or JSON {"type":"resize","cols":N,"rows":N}
      - Backend → Client: raw PTY output bytes (ANSI terminal sequences)
    """
    await websocket.accept()

    # Create PTY session and get WebSocket connection info
    try:
        pty_info = await daytona_service.create_pty_session(workspace_id)
    except Exception as e:
        error_msg = f"\r\n\x1b[31m[PTY Error: {e}]\x1b[0m\r\n"
        await websocket.send_bytes(error_msg.encode())
        await websocket.close()
        return

    session_id: str = pty_info["session_id"]
    ws_url: str = pty_info["ws_url"]
    ws_headers: dict = pty_info["ws_headers"]

    logger.info(f"PTY proxy open — session={session_id} workspace={workspace_id}")

    try:
        async with ext_ws.connect(ws_url, additional_headers=ws_headers) as pty_ws:

            async def client_to_pty() -> None:
                """Forward client input to the Daytona PTY."""
                try:
                    async for text in websocket.iter_text():
                        # Check for resize control message
                        try:
                            msg = json.loads(text)
                            if isinstance(msg, dict) and msg.get("type") == "resize":
                                await daytona_service.resize_pty_session(
                                    workspace_id,
                                    session_id,
                                    int(msg.get("cols", 80)),
                                    int(msg.get("rows", 24)),
                                )
                                continue
                        except (json.JSONDecodeError, ValueError, TypeError):
                            pass
                        # Forward raw keyboard input to PTY
                        await pty_ws.send(text.encode("utf-8"))
                except WebSocketDisconnect:
                    pass
                except Exception as exc:
                    logger.debug(f"client_to_pty ended: {exc}")
                finally:
                    await pty_ws.close()

            async def pty_to_client() -> None:
                """Forward PTY output to the browser client."""
                try:
                    async for message in pty_ws:
                        # Filter internal Daytona control messages (not terminal data)
                        if isinstance(message, str):
                            try:
                                ctrl = json.loads(message)
                                if isinstance(ctrl, dict) and ctrl.get("type") == "control":
                                    continue
                            except (json.JSONDecodeError, ValueError):
                                pass
                            await websocket.send_bytes(message.encode("utf-8"))
                        else:
                            await websocket.send_bytes(message)
                except Exception as exc:
                    logger.debug(f"pty_to_client ended: {exc}")

            await asyncio.gather(client_to_pty(), pty_to_client(), return_exceptions=True)

    except Exception as e:
        logger.error(f"PTY proxy error workspace={workspace_id}: {e}", exc_info=True)
    finally:
        await daytona_service.kill_pty_session(workspace_id, session_id)
        logger.info(f"PTY proxy closed — session={session_id}")
