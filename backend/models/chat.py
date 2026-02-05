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


class ChatResponse(BaseModel):
    """Chat response to frontend"""
    message: str
    file_operations: List[dict] = []
