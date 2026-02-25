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
    
    # For assistant messages, track any file operations
    file_operations: List[dict] = Field(default=[], description="Files created/edited by this message")
    
    class Config:
        populate_by_name = True


class ChatRequest(BaseModel):
    """Chat request from frontend"""
    message: str
    file_context: Optional[List[FileContext]] = None
    compiler: Optional[str] = None
    conversation_history: Optional[List[dict]] = None
    plan_mode: bool = False
    enable_websearch: bool = False


class ChatResponse(BaseModel):
    """Chat response to frontend"""
    message: str
    file_operations: List[dict] = []


class StepExecutionRequest(BaseModel):
    """Request to execute a single plan step with the agent"""
    step_title: str
    step_body: str
    workspace_id: Optional[str] = None
    file_context: Optional[List[FileContext]] = None
    compiler: Optional[str] = None
    enable_websearch: bool = False


class ExecutionLogEntry(BaseModel):
    """Record of a single sandbox command run during step execution"""
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
