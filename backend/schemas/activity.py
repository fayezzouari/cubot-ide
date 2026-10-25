from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel


class ProjectStats(BaseModel):
    total: int = 0
    missions: int = 0


class LessonStats(BaseModel):
    passed: int = 0
    in_progress: int = 0
    total: int = 0
    attempts: int = 0


class Category(BaseModel):
    name: str
    kind: Literal["track", "platform"]
    count: int
    total: Optional[int] = None


class ActivityEvent(BaseModel):
    kind: Literal["project_created", "mission_started", "mission_passed"]
    title: str
    at: datetime
    project_id: Optional[str] = None
    mission_id: Optional[str] = None


class UserActivity(BaseModel):
    projects: ProjectStats
    lessons: LessonStats
    categories: List[Category]
    concepts: List[str]
    events: List[ActivityEvent]
