from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class UserSync(BaseModel):
    google_id: str
    email: str
    name: str
    picture: Optional[str] = None


class UserResponse(BaseModel):
    id: str
    google_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
