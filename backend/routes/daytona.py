"""
API routes for Daytona workspace management
"""
from fastapi import APIRouter, HTTPException
from typing import List

from schemas.daytona import (
    DaytonaWorkspaceCreate,
    DaytonaWorkspaceResponse,
    CodeExecutionRequest,
    CodeExecutionResponse,
)
from services.daytona_service import daytona_service

router = APIRouter(tags=["daytona"])


@router.post("/daytona/workspaces", response_model=DaytonaWorkspaceResponse)
async def create_workspace(request: DaytonaWorkspaceCreate):
    """Create a new Daytona workspace for sandboxed execution"""
    try:
        workspace = await daytona_service.create_workspace(request)
        return workspace
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


@router.post("/daytona/execute", response_model=CodeExecutionResponse)
async def execute_code(request: CodeExecutionRequest):
    """Execute code in a Daytona workspace"""
    try:
        result = await daytona_service.execute_code(request)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
