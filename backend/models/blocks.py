from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime


class BlockNode(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]


class BlockEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None
    style: Optional[Dict[str, Any]] = None


class BlockProgram(BaseModel):
    id: Optional[str] = None
    project_id: str
    name: str
    nodes: List[BlockNode]
    edges: List[BlockEdge]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ArmState(BaseModel):
    position: Dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0, "z": 0})
    joints: List[float] = Field(default_factory=lambda: [0, 0, 0, 0, 0, 0])
    is_moving: bool = False
