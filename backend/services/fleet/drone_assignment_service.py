from math import dist

from schemas.fleet.assignment import DroneAssignment, DroneAssignmentResult
from services.fleet import db
from services.fleet.assignment_service import _eligible, _xyz
from services.fleet.ownership import get_owned_doc, touch


async def reassign_drones(project_id: str, user_id: str) -> DroneAssignmentResult:
    await get_owned_doc(project_id, user_id)

    drones = [
        d
        async for d in db.drones().find({
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
            "vehicle_kind": "aerial",
            "sequence_index": None,
        })
        .sort([("priority", -1), ("created_at", 1)])
    ]

    cursors: dict[str, tuple[float, float, float]] = {str(d["_id"]): _xyz(d.get("position", {})) for d in drones}
    drone_category: dict[str, str | None] = {str(d["_id"]): d.get("category_id") for d in drones}

    assignments: list[DroneAssignment] = []
    for task in tasks:
        tid = str(task["_id"])
        tpos = _xyz(task.get("position", {}))
        task_categories = task.get("category_ids") or []
        candidates = {
            did: cur for did, cur in cursors.items() if _eligible(drone_category.get(did), task_categories)
        }
        if not candidates:
            await db.tasks().update_one(
                {"_id": task["_id"]},
                {"$set": {"assigned_drone_id": None, "status": "pending"}},
            )
            assignments.append(DroneAssignment(task_id=tid, drone_id=None, distance=None))
            continue

        best_did, best_d = min(
            ((did, dist(cur, tpos)) for did, cur in candidates.items()),
            key=lambda kv: kv[1],
        )
        cursors[best_did] = tpos
        await db.tasks().update_one(
            {"_id": task["_id"]},
            {"$set": {"assigned_drone_id": best_did, "status": "assigned"}},
        )
        assignments.append(DroneAssignment(task_id=tid, drone_id=best_did, distance=best_d))

    await touch(project_id)
    return DroneAssignmentResult(assignments=assignments)
