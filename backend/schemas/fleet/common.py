from enum import Enum

from pydantic import BaseModel


class Dimension(str, Enum):
    two_d = "2d"
    three_d = "3d"


class Vec3(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
