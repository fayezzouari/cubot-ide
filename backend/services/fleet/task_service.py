from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from schemas.fleet.task import TaskCreate, TaskOut, TaskStatus, TaskUpdate
from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch


def _oid(task_id: str) -> ObjectId:
    try:
        return ObjectId(task_id)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")


async def _get_owned(task_id: str, project_id: str) -> dict:
    doc = await db.tasks().find_one({"_id": _oid(task_id), "project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return doc


async def list_tasks(project_id: str, user_id: str) -> list[TaskOut]:
    await get_owned_doc(project_id, user_id)
    cursor = db.tasks().find({"project_id": project_id}).sort([("priority", -1), ("created_at", 1)])
    return [TaskOut(**db.to_out(doc)) async for doc in cursor]


async def create_task(project_id: str, user_id: str, body: TaskCreate) -> TaskOut:
    await get_owned_doc(project_id, user_id)
    assigned = body.assigned_robot_id or body.assigned_drone_id
    doc = {
        "project_id": project_id,
        "name": body.name,
        "position": body.position.model_dump(),
        "priority": body.priority,
        "assigned_robot_id": body.assigned_robot_id,
        "category_ids": body.category_ids,
        "status": (TaskStatus.assigned if assigned else TaskStatus.pending).value,
        "created_at": datetime.now(timezone.utc),
        "deadline_s": body.deadline_s,
        "eta_s": None,
        "vehicle_kind": body.vehicle_kind,
        "assigned_drone_id": body.assigned_drone_id,
    }
    res = await db.tasks().insert_one(doc)
    doc["_id"] = res.inserted_id
    await touch(project_id)
    return TaskOut(**db.to_out(doc))


async def update_task(project_id: str, task_id: str, user_id: str, body: TaskUpdate) -> TaskOut:
    await get_owned_doc(project_id, user_id)
    await _get_owned(task_id, project_id)
    changes = body.model_dump(exclude_unset=True)
    if "position" in changes and changes["position"] is not None:
        changes["position"] = body.position.model_dump()
    if "status" in changes and changes["status"] is not None:
        changes["status"] = body.status.value
    if changes:
        await db.tasks().update_one({"_id": _oid(task_id)}, {"$set": changes})
        await touch(project_id)
    return TaskOut(**db.to_out(await _get_owned(task_id, project_id)))


async def delete_task(project_id: str, task_id: str, user_id: str) -> None:
    await get_owned_doc(project_id, user_id)
    await _get_owned(task_id, project_id)
    await db.tasks().delete_one({"_id": _oid(task_id)})
    await touch(project_id)
