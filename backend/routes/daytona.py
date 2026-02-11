"""
API routes for Daytona workspace management
Daytona sandboxes are only available for ROS projects.
"""
from fastapi import APIRouter, HTTPException
from typing import List

from schemas.daytona import (
    DaytonaWorkspaceCreate,
    DaytonaWorkspaceResponse,
    CodeExecutionRequest,
    CodeExecutionResponse,
    SyncFilesRequest,
    SyncFilesResponse,
)
from services.daytona_service import daytona_service
from services.project_service import ProjectService
from models.file import ProjectType

router = APIRouter(tags=["daytona"])


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

        if project.get("project_type") != ProjectType.ROS.value:
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

        if project.get("project_type") != ProjectType.ROS.value:
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


@router.post("/daytona/execute", response_model=CodeExecutionResponse)
async def execute_code(request: CodeExecutionRequest):
    """Execute code in a Daytona workspace"""
    try:
        result = await daytona_service.execute_code(request)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
