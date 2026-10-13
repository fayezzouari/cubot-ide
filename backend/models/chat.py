from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class FileContext(BaseModel):
    """File context for chat messages"""
    path: str
    content: str


class ChatMessageBase(BaseModel):
    """Base chat message model"""
    role: MessageRole
    content: str


class ChatMessageInDB(ChatMessageBase):
    """Chat message as stored in MongoDB"""
    id: str = Field(alias="_id")
    project_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    file_context: List[FileContext] = []

    # For assistant messages: files the agent created or changed. Each entry carries
    # operation, path, file_id, summary, added/removed line counts and previous_content
    # (null for created files) so the client can show a change card and revert it.
    file_operations: List[dict] = Field(default=[], description="Files created/edited by this message")
    mode: Optional[str] = Field(default=None, description="'build' or 'plan'")

    class Config:
        populate_by_name = True


class ChatRequest(BaseModel):
    """Chat request from frontend"""
    message: str
    file_context: Optional[List[FileContext]] = None
    active_file_path: Optional[str] = Field(default=None, description="Path of the file open in the editor")
    compiler: Optional[str] = None
    conversation_history: Optional[List[dict]] = None
    plan_mode: bool = False
    enable_websearch: bool = False
    workspace_id: Optional[str] = Field(default=None, description="Sandbox workspace for ROS projects")


class ChatResponse(BaseModel):
    """Chat response to frontend"""
    message: str
    file_operations: List[dict] = []
    execution_logs: List["ExecutionLogEntry"] = []


class StepExecutionRequest(BaseModel):
    """Request to execute a single plan step with the agent"""
    step_title: str
    step_body: str
    workspace_id: Optional[str] = None
    file_context: Optional[List[FileContext]] = None
    active_file_path: Optional[str] = None
    compiler: Optional[str] = None
    enable_websearch: bool = False


class ExecutionLogEntry(BaseModel):
    """Record of a single command run during an agent turn: a sandbox command or a compile."""
    command: str
    stdout: str
    stderr: str
    exit_code: int
    success: bool


class StepExecutionResponse(BaseModel):
    """Response after the agent executes a plan step"""
    message: str
    file_operations: List[dict] = []
    execution_logs: List[ExecutionLogEntry] = []
    success: bool = True


ChatResponse.model_rebuild()
