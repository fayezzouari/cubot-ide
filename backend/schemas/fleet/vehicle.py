from typing import Literal

from pydantic import BaseModel, Field

from schemas.fleet.common import Vec3

SequenceMode = Literal["auto", "manual"]
SequenceStatus = Literal["idle", "running", "held", "completed"]


class VehicleBase(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    position: Vec3 = Field(default_factory=Vec3)
    heading: float = 0.0
    speed: float = 1.0
    color: str = "#e0a06d"
    category_id: str | None = None
    sequence_mode: SequenceMode = "auto"
