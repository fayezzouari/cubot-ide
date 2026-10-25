from collections import Counter
from typing import Dict, List

from core.database import get_collection
from schemas.activity import ActivityEvent, Category, LessonStats, ProjectStats, UserActivity
from services.missions import catalog

PLATFORM_LABELS = {"arduino": "Arduino", "esp32": "ESP32", "ti_arm": "TI ARM", "ros": "ROS"}

EVENT_LIMIT = 20


def _platform(doc: dict) -> str:
    if doc.get("project_type") == "ros":
        return PLATFORM_LABELS["ros"]
    compiler = doc.get("target_compiler", "arduino")
    return PLATFORM_LABELS.get(compiler, compiler)


async def for_user(user_id: str) -> UserActivity:
    missions = {m.id: m for m in catalog.all_missions()}
    events: List[ActivityEvent] = []

    projects = ProjectStats()
    platforms: Counter = Counter()
    cursor = get_collection("projects").find(
        {"user_id": user_id},
        {"name": 1, "project_type": 1, "target_compiler": 1, "mission_id": 1, "created_at": 1},
    )
    async for doc in cursor:
        if doc.get("mission_id"):
            projects.missions += 1
            continue
        projects.total += 1
        platforms[_platform(doc)] += 1
        if doc.get("created_at"):
            events.append(ActivityEvent(
                kind="project_created",
                title=doc["name"],
                at=doc["created_at"],
                project_id=str(doc["_id"]),
            ))

    lessons = LessonStats(total=len(missions))
    track_passed: Counter = Counter()
    concepts: Dict[str, None] = {}
    async for doc in get_collection("mission_progress").find({"user_id": user_id}):
        mission = missions.get(doc["mission_id"])
        if not mission:
            continue
        lessons.attempts += doc.get("attempts", 0)
        if doc.get("created_at"):
            events.append(ActivityEvent(
                kind="mission_started",
                title=mission.title,
                at=doc["created_at"],
                project_id=doc.get("project_id"),
                mission_id=mission.id,
            ))
        if doc.get("status") == "passed":
            lessons.passed += 1
            track_passed[mission.track] += 1
            concepts.update(dict.fromkeys(mission.concepts))
            if doc.get("passed_at"):
                events.append(ActivityEvent(
                    kind="mission_passed",
                    title=mission.title,
                    at=doc["passed_at"],
                    project_id=doc.get("project_id"),
                    mission_id=mission.id,
                ))
        else:
            lessons.in_progress += 1

    track_totals = Counter(m.track for m in missions.values())
    categories = [
        Category(name=track, kind="track", count=count, total=track_totals[track])
        for track, count in track_passed.most_common()
    ] + [
        Category(name=platform, kind="platform", count=count)
        for platform, count in platforms.most_common()
    ]

    events.sort(key=lambda e: e.at, reverse=True)
    return UserActivity(
        projects=projects,
        lessons=lessons,
        categories=categories,
        concepts=list(concepts),
        events=events[:EVENT_LIMIT],
    )
