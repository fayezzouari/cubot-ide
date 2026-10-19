from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = "#9b927f"


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = None


class CategoryOut(BaseModel):
    id: str
    project_id: str
    name: str
    color: str
