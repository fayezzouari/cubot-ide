from enum import Enum

from pydantic import Field

from schemas.fleet.common import Vec3
from schemas.fleet.vehicle import SequenceStatus, VehicleBase


class DroneStatus(str, Enum):
    idle = "idle"
    flying = "flying"
    hovering = "hovering"
    charging = "charging"
    working = "working"


class DroneCreate(VehicleBase):
    pass


class DroneUpdate(VehicleBase):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    position: Vec3 | None = None
    heading: float | None = None
    speed: float | None = None
    color: str | None = None
    category_id: str | None = None
    status: DroneStatus | None = None


class DroneOut(VehicleBase):
    id: str
    project_id: str
    status: DroneStatus
    serial_number: str
    manufacturer: str
    sequence_status: SequenceStatus = "idle"
    sequence_cursor: int = 0
