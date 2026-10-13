"""
Conversation threads for the IDE assistant. A thread groups the messages of one
conversation inside a project; the title comes from the first user message.
"""

from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from bson.errors import InvalidId

from core.database import get_collection
from models.chat import ThreadSummary

THREADS = "chat_threads"
MESSAGES = "chat_messages"
TITLE_MAX = 60
LEGACY_TITLE = "Earlier conversation"


def _oid(thread_id: str) -> Optional[ObjectId]:
    try:
        return ObjectId(thread_id)
    except (InvalidId, TypeError):
        return None


def title_from(message: str) -> str:
    text = " ".join(message.split())
    return text if len(text) <= TITLE_MAX else text[: TITLE_MAX - 1].rstrip() + "…"


async def create_thread(project_id: str, title: Optional[str] = None) -> str:
    now = datetime.utcnow()
    result = await get_collection(THREADS).insert_one({
        "project_id": project_id,
        "title": title or "",
        "created_at": now,
        "updated_at": now,
    })
    return str(result.inserted_id)


async def get_thread(project_id: str, thread_id: str) -> Optional[dict]:
    oid = _oid(thread_id)
    if oid is None:
        return None
    return await get_collection(THREADS).find_one({"_id": oid, "project_id": project_id})


async def touch_thread(project_id: str, thread_id: str, first_message: Optional[str] = None) -> None:
    oid = _oid(thread_id)
    if oid is None:
        return
    update = {"$set": {"updated_at": datetime.utcnow()}}
    thread = await get_collection(THREADS).find_one({"_id": oid, "project_id": project_id}, {"title": 1})
    if thread is not None and not thread.get("title") and first_message:
        update["$set"]["title"] = title_from(first_message)
    await get_collection(THREADS).update_one({"_id": oid, "project_id": project_id}, update)


async def rename_thread(project_id: str, thread_id: str, title: str) -> bool:
    oid = _oid(thread_id)
    if oid is None:
        return False
    result = await get_collection(THREADS).update_one(
        {"_id": oid, "project_id": project_id},
        {"$set": {"title": title_from(title), "updated_at": datetime.utcnow()}},
    )
    return result.matched_count > 0


async def delete_thread(project_id: str, thread_id: str) -> bool:
    oid = _oid(thread_id)
    if oid is None:
        return False
    result = await get_collection(THREADS).delete_one({"_id": oid, "project_id": project_id})
    await get_collection(MESSAGES).delete_many({"project_id": project_id, "thread_id": thread_id})
    return result.deleted_count > 0


async def _adopt_legacy_messages(project_id: str) -> None:
    """Messages saved before threads existed go into one thread so they stay reachable."""
    messages = get_collection(MESSAGES)
    legacy = {"project_id": project_id, "thread_id": {"$exists": False}}
    first = await messages.find_one(legacy, sort=[("timestamp", 1)])
    if first is None:
        return
    thread_id = await create_thread(project_id, LEGACY_TITLE)
    await messages.update_many(legacy, {"$set": {"thread_id": thread_id}})
    last = await messages.find_one({"project_id": project_id, "thread_id": thread_id}, sort=[("timestamp", -1)])
    await get_collection(THREADS).update_one(
        {"_id": ObjectId(thread_id)},
        {"$set": {"created_at": first["timestamp"], "updated_at": (last or first)["timestamp"]}},
    )


async def list_threads(project_id: str) -> List[ThreadSummary]:
    await _adopt_legacy_messages(project_id)
    counts = {}
    async for row in get_collection(MESSAGES).aggregate([
        {"$match": {"project_id": project_id, "thread_id": {"$exists": True}}},
        {"$group": {"_id": "$thread_id", "count": {"$sum": 1}, "last": {"$max": "$timestamp"}}},
    ]):
        counts[row["_id"]] = row
    threads = []
    cursor = get_collection(THREADS).find({"project_id": project_id}).sort("updated_at", -1)
    async for doc in cursor:
        thread_id = str(doc["_id"])
        stats = counts.get(thread_id, {})
        threads.append(ThreadSummary(
            id=thread_id,
            project_id=project_id,
            title=doc.get("title") or "New chat",
            created_at=doc["created_at"],
            updated_at=stats.get("last") or doc["updated_at"],
            message_count=stats.get("count", 0),
        ))
    return threads
