from enum import Enum

from pydantic import BaseModel, Field

from schemas.fleet.common import Vec3
from schemas.fleet.vehicle import SequenceMode, SequenceStatus


class RobotStatus(str, Enum):
    idle = "idle"
    moving = "moving"
    working = "working"


class RobotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    position: Vec3 = Field(default_factory=Vec3)
    heading: float = 0.0
    speed: float = 1.0
    color: str = "#e0a06d"
    category_id: str | None = None
    sequence_mode: SequenceMode = "auto"


class RobotUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    position: Vec3 | None = None
    heading: float | None = None
    speed: float | None = None
    color: str | None = None
    category_id: str | None = None
    status: RobotStatus | None = None
    sequence_mode: SequenceMode | None = None


class RobotOut(BaseModel):
    id: str
    project_id: str
    name: str
    position: Vec3
    heading: float
    speed: float
    color: str
    category_id: str | None = None
    status: RobotStatus
    serial_number: str
    manufacturer: str
    sequence_mode: SequenceMode = "auto"
    sequence_status: SequenceStatus = "idle"
    sequence_cursor: int = 0
