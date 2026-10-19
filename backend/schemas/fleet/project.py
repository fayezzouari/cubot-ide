from datetime import datetime

from pydantic import BaseModel

from schemas.fleet.common import Dimension


class ProjectInit(BaseModel):
    dimension: Dimension = Dimension.two_d


class ProjectOut(BaseModel):
    id: str
    name: str
    dimension: Dimension
    description: str = ""
    created_at: datetime
    updated_at: datetime
    robot_count: int = 0
    task_count: int = 0
