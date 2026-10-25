from datetime import datetime
from typing import Dict, Optional

from core.database import get_collection
from schemas.missions import ProgressEntry

COLLECTION = "mission_progress"


def _collection():
    return get_collection(COLLECTION)


async def ensure_indexes() -> None:
    await _collection().create_index([("user_id", 1), ("mission_id", 1)], unique=True)


async def for_user(user_id: str) -> Dict[str, ProgressEntry]:
    entries: Dict[str, ProgressEntry] = {}
    async for doc in _collection().find({"user_id": user_id}):
        entries[doc["mission_id"]] = ProgressEntry(
            mission_id=doc["mission_id"],
            status=doc.get("status", "started"),
            project_id=doc.get("project_id"),
            attempts=doc.get("attempts", 0),
            passed_at=doc.get("passed_at"),
        )
    return entries


async def get(user_id: str, mission_id: str) -> Optional[ProgressEntry]:
    return (await for_user(user_id)).get(mission_id)


async def mark_started(user_id: str, mission_id: str, project_id: str) -> None:
    await _collection().update_one(
        {"user_id": user_id, "mission_id": mission_id},
        {
            "$set": {"project_id": project_id, "updated_at": datetime.utcnow()},
            "$setOnInsert": {"status": "started", "attempts": 0, "created_at": datetime.utcnow()},
        },
        upsert=True,
    )


async def record_attempt(user_id: str, mission_id: str, passed: bool) -> None:
    update: dict = {"$inc": {"attempts": 1}, "$set": {"updated_at": datetime.utcnow()}}
    if passed:
        update["$set"].update({"status": "passed", "passed_at": datetime.utcnow()})
    else:
        update["$setOnInsert"] = {"status": "started", "created_at": datetime.utcnow()}
    await _collection().update_one({"user_id": user_id, "mission_id": mission_id}, update, upsert=True)
