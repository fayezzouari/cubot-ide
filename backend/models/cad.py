from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class CadMessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class CadMessage(BaseModel):
    """A single message in the CAD conversation"""
    role: CadMessageRole
    content: str
    cadquery_code: Optional[str] = None
    has_model: bool = False


class CadChatRequest(BaseModel):
    """Request from frontend to generate/update a CAD model"""
    message: str
    conversation_history: Optional[List[dict]] = None
    current_code: Optional[str] = None  # Current CadQuery code for iteration


class CadChatResponse(BaseModel):
    """Response with generated CadQuery code and explanation"""
    message: str
    cadquery_code: Optional[str] = None
    stl_base64: Optional[str] = None  # Base64-encoded STL for immediate preview
    error: Optional[str] = None


class CadExportRequest(BaseModel):
    """Request to export model as STL"""
    cadquery_code: str


class CadSessionInDB(BaseModel):
    """CAD session stored in MongoDB"""
    id: str = Field(alias="_id")
    session_id: str
    messages: List[CadMessage] = []
    current_code: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
