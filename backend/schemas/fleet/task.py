from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from schemas.fleet.common import Vec3

VehicleKind = Literal["ground", "aerial"]


class TaskStatus(str, Enum):
    pending = "pending"
    assigned = "assigned"
    done = "done"


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    position: Vec3 = Field(default_factory=Vec3)
    priority: int = Field(default=1, ge=0, le=10)
    assigned_robot_id: str | None = None
    category_ids: list[str] = Field(default_factory=list)
    deadline_s: float | None = Field(default=None, ge=0)
    vehicle_kind: VehicleKind = "ground"
    assigned_drone_id: str | None = None


class TaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    position: Vec3 | None = None
    priority: int | None = Field(default=None, ge=0, le=10)
    assigned_robot_id: str | None = None
    category_ids: list[str] | None = None
    status: TaskStatus | None = None
    deadline_s: float | None = Field(default=None, ge=0)
    vehicle_kind: VehicleKind | None = None
    assigned_drone_id: str | None = None


class TaskOut(BaseModel):
    id: str
    project_id: str
    name: str
    position: Vec3
    priority: int
    assigned_robot_id: str | None = None
    category_ids: list[str] = Field(default_factory=list)
    status: TaskStatus
    created_at: datetime
    deadline_s: float | None = None
    eta_s: float | None = None
    vehicle_kind: VehicleKind = "ground"
    assigned_drone_id: str | None = None
    sequence_index: int | None = None
