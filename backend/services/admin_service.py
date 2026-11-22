"""Platform-wide stats for the admin dashboard. All days are UTC calendar days."""
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from core.config import settings
from core.database import get_collection
from schemas.admin import AdminOverview, AdminUsage, AdminUserPage, AdminUserRow, Metric, UsagePoint


@dataclass(frozen=True)
class _Source:
    key: str
    label: str
    collection: str
    date_field: str
    filter: Dict = field(default_factory=dict)


# Mission projects are created for lessons, so they are left out of "projects", as on the profile page.
SOURCES = (
    _Source("users", "Users", "users", "created_at"),
    _Source("projects", "Projects", "projects", "created_at", {"mission_id": None}),
    _Source("ai_messages", "AI messages", "chat_messages", "timestamp", {"role": "user"}),
    _Source("lessons_passed", "Lessons passed", "mission_progress", "passed_at", {"status": "passed"}),
)


def _today_start() -> datetime:
    now = datetime.utcnow()
    return datetime(now.year, now.month, now.day)


async def _count(src: _Source, start: Optional[datetime] = None, end: Optional[datetime] = None) -> int:
    query = dict(src.filter)
    if start or end:
        query[src.date_field] = {k: v for k, v in (("$gte", start), ("$lt", end)) if v}
    return await get_collection(src.collection).count_documents(query)


async def overview() -> AdminOverview:
    today = _today_start()
    yesterday = today - timedelta(days=1)
    metrics = [
        Metric(
            key=src.key,
            label=src.label,
            total=await _count(src),
            today=await _count(src, start=today),
            yesterday=await _count(src, start=yesterday, end=today),
        )
        for src in SOURCES
    ]
    return AdminOverview(metrics=metrics, generated_at=datetime.utcnow())


async def usage(days: int) -> AdminUsage:
    start = _today_start() - timedelta(days=days - 1)
    dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    points = {d: UsagePoint(date=d) for d in dates}

    for src in SOURCES:
        pipeline = [
            {"$match": {**src.filter, src.date_field: {"$gte": start}}},
            {"$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": f"${src.date_field}"}},
                "n": {"$sum": 1},
            }},
        ]
        async for row in get_collection(src.collection).aggregate(pipeline):
            if row["_id"] in points:
                setattr(points[row["_id"]], src.key, row["n"])

    return AdminUsage(days=days, points=[points[d] for d in dates])


async def list_users(search: str = "", skip: int = 0, limit: int = 50) -> AdminUserPage:
    query: Dict = {}
    if search.strip():
        pattern = {"$regex": re.escape(search.strip()), "$options": "i"}
        query = {"$or": [{"email": pattern}, {"name": pattern}]}

    users = get_collection("users")
    total = await users.count_documents(query)
    docs = await users.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
    ids = [d["google_id"] for d in docs]

    projects: Dict[str, Dict] = {}
    async for row in get_collection("projects").aggregate([
        {"$match": {"user_id": {"$in": ids}}},
        {"$group": {
            "_id": "$user_id",
            "count": {"$sum": {"$cond": [{"$ifNull": ["$mission_id", False]}, 0, 1]}},
            "last": {"$max": "$updated_at"},
        }},
    ]):
        projects[row["_id"]] = row

    lessons: Dict[str, Dict] = {}
    async for row in get_collection("mission_progress").aggregate([
        {"$match": {"user_id": {"$in": ids}}},
        {"$group": {
            "_id": "$user_id",
            "passed": {"$sum": {"$cond": [{"$eq": ["$status", "passed"]}, 1, 0]}},
            "last": {"$max": "$updated_at"},
        }},
    ]):
        lessons[row["_id"]] = row

    items: List[AdminUserRow] = []
    for d in docs:
        p, l = projects.get(d["google_id"], {}), lessons.get(d["google_id"], {})
        seen = [t for t in (p.get("last"), l.get("last"), d.get("updated_at")) if t]
        items.append(AdminUserRow(
            id=str(d["_id"]),
            google_id=d["google_id"],
            email=d["email"],
            name=d["name"],
            picture=d.get("picture"),
            is_admin=settings.is_admin_email(d["email"]),
            projects=p.get("count", 0),
            lessons_passed=l.get("passed", 0),
            last_active_at=max(seen) if seen else None,
            created_at=d["created_at"],
        ))
    return AdminUserPage(total=total, items=items)
