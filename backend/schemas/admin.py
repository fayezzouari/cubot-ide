from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class Metric(BaseModel):
    key: str
    label: str
    total: int
    today: int
    yesterday: int


class AdminOverview(BaseModel):
    metrics: List[Metric]
    generated_at: datetime


class UsagePoint(BaseModel):
    date: str  # YYYY-MM-DD, UTC
    users: int = 0
    projects: int = 0
    ai_messages: int = 0
    lessons_passed: int = 0


class AdminUsage(BaseModel):
    days: int
    points: List[UsagePoint]


class AdminUserRow(BaseModel):
    id: str
    google_id: str
    email: str
    name: str
    picture: Optional[str] = None
    is_admin: bool
    projects: int
    lessons_passed: int
    last_active_at: Optional[datetime] = None
    created_at: datetime


class AdminUserPage(BaseModel):
    total: int
    items: List[AdminUserRow]
