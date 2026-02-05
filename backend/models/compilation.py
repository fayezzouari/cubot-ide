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
    compiler: CompilerType
    file_ids: List[str]
    main_file: str
    build_flags: Optional[List[str]] = None
    project_id: Optional[str] = None
    

class CompileResult(BaseModel):
    """Compilation result"""
    status: CompilationStatus
    output: str = ""
    errors: List[str] = []
    binary_data: Optional[bytes] = None
    binary_name: Optional[str] = None
    compile_time_ms: int = 0


class CompilationInDB(BaseModel):
    """Compilation record stored in MongoDB"""
    id: str = Field(alias="_id")
    project_id: str
    compiler: CompilerType
    status: CompilationStatus
    output: str = ""
    errors: List[str] = []
    binary_name: Optional[str] = None
    compile_time_ms: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True


class CompilationResponse(BaseModel):
    """Compilation response to frontend"""
    status: CompilationStatus
    output: str
    errors: List[str]
    binary_name: Optional[str]
    compile_time_ms: int
    has_binary: bool
