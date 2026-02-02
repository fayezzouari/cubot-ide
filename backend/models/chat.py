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
    file_id: str
    file_name: str
    file_path: str
    content: str


class ChatMessageBase(BaseModel):
    """Base chat message model"""
    role: MessageRole
    content: str
    

class ChatMessageCreate(ChatMessageBase):
    """Model for creating a chat message"""
    project_id: str
    context_files: List[FileContext] = Field(default=[])


class ChatMessageInDB(ChatMessageBase):
    """Chat message as stored in MongoDB"""
    id: str = Field(alias="_id")
    project_id: str
    context_files: List[FileContext] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # For assistant messages, track any file operations
    file_operations: List[dict] = Field(default=[], description="Files created/edited by this message")
    
    class Config:
        populate_by_name = True


class ChatMessageResponse(ChatMessageBase):
    """Chat message response model"""
    id: str
    project_id: str
    context_files: List[FileContext] = []
    created_at: datetime
    file_operations: List[dict] = []
    
    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    """Chat request from frontend"""
    project_id: str
    message: str
    context_file_ids: List[str] = Field(default=[], description="File IDs to include as context")


class ChatResponse(BaseModel):
    """Chat response to frontend"""
    message: ChatMessageResponse
    files_created: List[dict] = []
    files_updated: List[dict] = []
