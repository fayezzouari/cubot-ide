from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from core.config import settings
from schemas.fleet.robot import RobotCreate, RobotOut, RobotStatus, RobotUpdate
from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch
from services.fleet.vehicles import robot_out


def _oid(robot_id: str) -> ObjectId:
    try:
        return ObjectId(robot_id)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Robot not found")


async def _get_owned(robot_id: str, project_id: str) -> dict:
    doc = await db.robots().find_one({"_id": _oid(robot_id), "project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Robot not found")
    return doc


async def list_robots(project_id: str, user_id: str) -> list[RobotOut]:
    await get_owned_doc(project_id, user_id)
    cursor = db.robots().find({"project_id": project_id})
    return [robot_out(doc) async for doc in cursor]


async def create_robot(project_id: str, user_id: str, body: RobotCreate) -> RobotOut:
    await get_owned_doc(project_id, user_id)
    seq = await db.robots().count_documents({"project_id": project_id}) + 1
    doc = {
        "project_id": project_id,
        "name": body.name,
        "position": body.position.model_dump(),
        "heading": body.heading,
        "speed": body.speed,
        "color": body.color,
        "category_id": body.category_id,
        "status": RobotStatus.idle.value,
        "serial_number": f"AMR-{seq:04d}",
        "manufacturer": settings.FLEET_MANUFACTURER,
        "sequence_mode": body.sequence_mode,
        "sequence_status": "idle",
        "sequence_cursor": 0,
    }
    res = await db.robots().insert_one(doc)
    doc["_id"] = res.inserted_id
    await touch(project_id)
    return robot_out(doc)


async def update_robot(project_id: str, robot_id: str, user_id: str, body: RobotUpdate) -> RobotOut:
    await get_owned_doc(project_id, user_id)
    await _get_owned(robot_id, project_id)
    changes = body.model_dump(exclude_unset=True)
    if "position" in changes and changes["position"] is not None:
        changes["position"] = body.position.model_dump()
    if "status" in changes and changes["status"] is not None:
        changes["status"] = body.status.value
    if changes:
        await db.robots().update_one({"_id": _oid(robot_id)}, {"$set": changes})
        await touch(project_id)
    return robot_out(await _get_owned(robot_id, project_id))


async def delete_robot(project_id: str, robot_id: str, user_id: str) -> None:
    await get_owned_doc(project_id, user_id)
    await _get_owned(robot_id, project_id)
    await db.robots().delete_one({"_id": _oid(robot_id)})
    await db.tasks().update_many(
        {"project_id": project_id, "assigned_robot_id": robot_id},
        {"$set": {"assigned_robot_id": None, "status": "pending"}},
    )
    await touch(project_id)
