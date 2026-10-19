from math import dist

from schemas.fleet.assignment import Assignment, AssignmentResult
from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch


def _xyz(pos: dict) -> tuple[float, float, float]:
    return (pos.get("x", 0.0), pos.get("y", 0.0), pos.get("z", 0.0))


def _eligible(robot_category: str | None, task_categories: list[str]) -> bool:
    if not robot_category or not task_categories:
        return True
    return robot_category in task_categories


async def reassign(project_id: str, user_id: str) -> AssignmentResult:
    await get_owned_doc(project_id, user_id)

    robots = [
        r
        async for r in db.robots().find({
            "project_id": project_id,
            "sequence_status": {"$in": [None, "idle"]},
        })
    ]
    tasks = [
        t
        async for t in db.tasks()
        .find({
            "project_id": project_id,
            "status": {"$ne": "done"},
            "vehicle_kind": {"$ne": "aerial"},
            "sequence_index": None,
        })
        .sort([("priority", -1), ("created_at", 1)])
    ]

    cursors: dict[str, tuple[float, float, float]] = {str(r["_id"]): _xyz(r.get("position", {})) for r in robots}
    robot_category: dict[str, str | None] = {str(r["_id"]): r.get("category_id") for r in robots}

    assignments: list[Assignment] = []
    for task in tasks:
        tid = str(task["_id"])
        tpos = _xyz(task.get("position", {}))
        task_categories = task.get("category_ids") or []
        candidates = {
            rid: cur for rid, cur in cursors.items() if _eligible(robot_category.get(rid), task_categories)
        }
        if not candidates:
            await db.tasks().update_one(
                {"_id": task["_id"]},
                {"$set": {"assigned_robot_id": None, "status": "pending"}},
            )
            assignments.append(Assignment(task_id=tid, robot_id=None, distance=None))
            continue

        best_rid, best_d = min(
            ((rid, dist(cur, tpos)) for rid, cur in candidates.items()),
            key=lambda kv: kv[1],
        )
        cursors[best_rid] = tpos
        await db.tasks().update_one(
            {"_id": task["_id"]},
            {"$set": {"assigned_robot_id": best_rid, "status": "assigned"}},
        )
        assignments.append(Assignment(task_id=tid, robot_id=best_rid, distance=best_d))

    await touch(project_id)
    return AssignmentResult(assignments=assignments)
