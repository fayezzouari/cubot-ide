"""
Schemas for Daytona workspace integration
Daytona sandboxes are only available for ROS projects.
"""
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from enum import Enum


class WorkspaceState(str, Enum):
    CREATING = "creating"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"


class DaytonaWorkspaceCreate(BaseModel):
    """Request to create a Daytona workspace"""
    project_id: str
    repository_url: Optional[str] = None
    branch: Optional[str] = "main"
    ide: str = "vscode"  # vscode, cursor, etc.
    env_vars: Dict[str, str] = {}


class DaytonaWorkspaceResponse(BaseModel):
    """Daytona workspace information"""
    workspace_id: str
    project_id: str
    state: WorkspaceState
    url: Optional[str] = None  # IDE access URL
    ssh_url: Optional[str] = None
    created_at: str
    metadata: Dict[str, Any] = {}
    files_synced: int = 0
    sync_status: str = "none"  # none, syncing, synced, partial, failed


class SyncFilesRequest(BaseModel):
    """Request to sync project files to sandbox"""
    project_id: str


class SyncFilesResponse(BaseModel):
    """Result of file sync operation"""
    sandbox_id: str
    files_synced: int
    sync_status: str  # synced, partial, failed
    errors: List[str] = []


class CodeExecutionRequest(BaseModel):
    """Request to execute code in Daytona workspace"""
    workspace_id: str
    code: str
    language: str = "python"
    timeout: int = 30  # seconds
    env_vars: Dict[str, str] = {}


class CodeExecutionResponse(BaseModel):
    """Result of code execution"""
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    execution_time: float
    error: Optional[str] = None
