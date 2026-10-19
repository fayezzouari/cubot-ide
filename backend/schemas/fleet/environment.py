from typing import Literal

from pydantic import BaseModel, Field

from schemas.fleet.common import Dimension

BackgroundPreset = Literal["warehouse", "blueprint", "concrete", "hazard", "sand"]

DEFAULT_BACKGROUND: BackgroundPreset = "warehouse"


class EnvironmentUpdate(BaseModel):
    width: int | None = Field(default=None, ge=1, le=200)
    height: int | None = Field(default=None, ge=1, le=200)
    depth: int | None = Field(default=None, ge=1, le=200)
    obstacles: list[list[int]] | None = None
    background: BackgroundPreset | None = None


class EnvironmentOut(BaseModel):
    project_id: str
    dimension: Dimension
    width: int
    height: int
    depth: int
    obstacles: list[list[int]]
    background: BackgroundPreset = DEFAULT_BACKGROUND
