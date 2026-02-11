from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
from enum import Enum


class PyObjectId(ObjectId):
    """Custom ObjectId type for Pydantic"""
    @classmethod
    def __get_validators__(cls):
        yield cls.validate
    
    @classmethod
    def validate(cls, v, info=None):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)
    
    @classmethod
    def __get_pydantic_json_schema__(cls, schema, handler):
        return {"type": "string"}


class FileType(str, Enum):
    C = "c"
    CPP = "cpp"
    H = "h"
    HPP = "hpp"
    INO = "ino"
    PY = "py"
    TXT = "txt"
    MD = "md"
    JSON = "json"
    MAKEFILE = "makefile"
    OTHER = "other"


class CompilerType(str, Enum):
    ARDUINO = "arduino"
    TI_ARM = "ti_arm"
    ESP32 = "esp32"


class ProjectType(str, Enum):
    EMBEDDED = "embedded"  # Arduino, ESP32, etc.
    ROS = "ros"  # ROS/ROS2 projects with Daytona sandbox access


class FileBase(BaseModel):
    """Base file model"""
    name: str = Field(..., min_length=1, max_length=255)
    path: str = Field(..., description="Virtual path in the project, e.g., 'src/main.c'")
    content: str = Field(default="")
    file_type: FileType = Field(default=FileType.OTHER)
    

class FileCreate(FileBase):
    """Model for creating a new file"""
    project_id: str = Field(..., description="Project this file belongs to")


class FileUpdate(BaseModel):
    """Model for updating a file"""
    name: Optional[str] = None
    path: Optional[str] = None
    content: Optional[str] = None
    file_type: Optional[FileType] = None


class FileInDB(FileBase):
    """File model as stored in MongoDB"""
    id: str = Field(alias="_id")
    project_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: str = Field(default="user", description="'user' or 'agent'")
    
    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}


class FileResponse(FileBase):
    """File response model"""
    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime
    created_by: str
    
    class Config:
        from_attributes = True
