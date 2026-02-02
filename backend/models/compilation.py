from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

from .file import CompilerType


class CompilationStatus(str, Enum):
    PENDING = "pending"
    COMPILING = "compiling"
    SUCCESS = "success"
    ERROR = "error"
    TIMEOUT = "timeout"


class CompileRequest(BaseModel):
    """Request to compile code"""
    project_id: str
    compiler: CompilerType
    main_file: Optional[str] = Field(default=None, description="Main file to compile, defaults to main.c or main.ino")
    

class CompileResult(BaseModel):
    """Compilation result"""
    status: CompilationStatus
    stdout: str = ""
    stderr: str = ""
    binary_size: Optional[int] = None
    compilation_time: float = 0.0  # seconds
    errors: List[dict] = []
    warnings: List[dict] = []


class CompilationInDB(BaseModel):
    """Compilation record stored in MongoDB"""
    id: str = Field(alias="_id")
    project_id: str
    compiler: CompilerType
    status: CompilationStatus
    stdout: str = ""
    stderr: str = ""
    binary_size: Optional[int] = None
    compilation_time: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True


class CompilationResponse(BaseModel):
    """Compilation response to frontend"""
    id: str
    project_id: str
    compiler: CompilerType
    status: CompilationStatus
    stdout: str
    stderr: str
    binary_size: Optional[int]
    compilation_time: float
    created_at: datetime
    
    class Config:
        from_attributes = True
