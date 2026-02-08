from pydantic import BaseModel
from typing import List, Dict, Any, Optional


class NodeSchema(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]


class EdgeSchema(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None
    style: Optional[Dict[str, Any]] = None


class BlockProgramCreate(BaseModel):
    project_id: str
    name: str
    nodes: List[NodeSchema]
    edges: List[EdgeSchema]


class BlockProgramUpdate(BaseModel):
    name: Optional[str] = None
    nodes: Optional[List[NodeSchema]] = None
    edges: Optional[List[EdgeSchema]] = None


class BlockProgramResponse(BaseModel):
    id: str
    project_id: str
    name: str
    nodes: List[NodeSchema]
    edges: List[EdgeSchema]
    created_at: str
    updated_at: str


class ArmStateResponse(BaseModel):
    position: Dict[str, float]
    joints: List[float]
    is_moving: bool
