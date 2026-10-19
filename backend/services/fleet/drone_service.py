from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from core.config import settings
from schemas.fleet.drone import DroneCreate, DroneOut, DroneStatus, DroneUpdate
from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch
from services.fleet.vehicles import drone_out


def _oid(drone_id: str) -> ObjectId:
    try:
        return ObjectId(drone_id)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Drone not found")


async def _get_owned(drone_id: str, project_id: str) -> dict:
    doc = await db.drones().find_one({"_id": _oid(drone_id), "project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Drone not found")
    return doc


async def list_drones(project_id: str, user_id: str) -> list[DroneOut]:
    await get_owned_doc(project_id, user_id)
    cursor = db.drones().find({"project_id": project_id})
    return [drone_out(doc) async for doc in cursor]


async def create_drone(project_id: str, user_id: str, body: DroneCreate) -> DroneOut:
    await get_owned_doc(project_id, user_id)
    seq = await db.drones().count_documents({"project_id": project_id}) + 1
    doc = {
        "project_id": project_id,
        "name": body.name,
        "position": body.position.model_dump(),
        "heading": body.heading,
        "speed": body.speed,
        "color": body.color,
        "category_id": body.category_id,
        "status": DroneStatus.idle.value,
        "serial_number": f"UAV-{seq:04d}",
        "manufacturer": settings.FLEET_MANUFACTURER,
        "sequence_mode": body.sequence_mode,
        "sequence_status": "idle",
        "sequence_cursor": 0,
    }
    res = await db.drones().insert_one(doc)
    doc["_id"] = res.inserted_id
    await touch(project_id)
    return drone_out(doc)


async def update_drone(project_id: str, drone_id: str, user_id: str, body: DroneUpdate) -> DroneOut:
    await get_owned_doc(project_id, user_id)
    await _get_owned(drone_id, project_id)
    changes = body.model_dump(exclude_unset=True)
    if "position" in changes and changes["position"] is not None:
        changes["position"] = body.position.model_dump()
    if "status" in changes and changes["status"] is not None:
        changes["status"] = body.status.value
    if changes:
        await db.drones().update_one({"_id": _oid(drone_id)}, {"$set": changes})
        await touch(project_id)
    return drone_out(await _get_owned(drone_id, project_id))


async def delete_drone(project_id: str, drone_id: str, user_id: str) -> None:
    await get_owned_doc(project_id, user_id)
    await _get_owned(drone_id, project_id)
    await db.drones().delete_one({"_id": _oid(drone_id)})
    await db.tasks().update_many(
        {"project_id": project_id, "assigned_drone_id": drone_id},
        {"$set": {"assigned_drone_id": None, "status": "pending"}},
    )
    await touch(project_id)
