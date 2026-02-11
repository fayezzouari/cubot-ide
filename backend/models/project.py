from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

from .file import CompilerType, ProjectType


class ProjectBase(BaseModel):
    """Base project model"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(default="")
    target_compiler: CompilerType = Field(default=CompilerType.ARDUINO)
    project_type: ProjectType = Field(default=ProjectType.EMBEDDED)


class ProjectCreate(ProjectBase):
    """Model for creating a new project"""
    pass


class ProjectUpdate(BaseModel):
    """Model for updating a project"""
    name: Optional[str] = None
    description: Optional[str] = None
    target_compiler: Optional[CompilerType] = None
    project_type: Optional[ProjectType] = None


class ProjectInDB(ProjectBase):
    """Project model as stored in MongoDB"""
    id: str = Field(alias="_id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True


class ProjectResponse(ProjectBase):
    """Project response model"""
    id: str
    created_at: datetime
    updated_at: datetime
    file_count: int = 0
    
    class Config:
        from_attributes = True


class ProjectWithFiles(ProjectResponse):
    """Project with its files"""
    files: List[dict] = []
