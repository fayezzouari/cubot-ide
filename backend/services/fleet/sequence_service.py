from collections.abc import Callable
from typing import Any, Literal, TypedDict

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from pydantic import BaseModel

from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch
from services.fleet.vehicles import drone_out, robot_out

VehicleKind = Literal["robot", "drone"]


class _KindConfig(TypedDict):
    collection: Callable[[], Any]
    assigned_field: str
    out: Callable[[dict], BaseModel]
    not_found: str


_KINDS: dict[VehicleKind, _KindConfig] = {
    "robot": {
        "collection": db.robots,
        "assigned_field": "assigned_robot_id",
        "out": robot_out,
        "not_found": "Robot not found",
    },
    "drone": {
        "collection": db.drones,
        "assigned_field": "assigned_drone_id",
        "out": drone_out,
        "not_found": "Drone not found",
    },
}


def _oid(vehicle_id: str, not_found: str) -> ObjectId:
    try:
        return ObjectId(vehicle_id)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, not_found)


async def _get_owned(kind: VehicleKind, vehicle_id: str, project_id: str) -> dict:
    cfg = _KINDS[kind]
    doc = await cfg["collection"]().find_one({"_id": _oid(vehicle_id, cfg["not_found"]), "project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, cfg["not_found"])
    return doc


async def start_sequence(project_id: str, user_id: str, kind: VehicleKind, vehicle_id: str) -> BaseModel:
    await get_owned_doc(project_id, user_id)
    cfg = _KINDS[kind]
    vehicle = await _get_owned(kind, vehicle_id, project_id)

    tasks = [
        t
        async for t in db.tasks()
        .find({
            "project_id": project_id,
            cfg["assigned_field"]: vehicle_id,
            "status": {"$ne": "done"},
        })
        .sort([("priority", -1), ("created_at", 1)])
    ]
    if not tasks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vehicle has no open assigned tasks to sequence")

    for i, t in enumerate(tasks):
        await db.tasks().update_one({"_id": t["_id"]}, {"$set": {"sequence_index": i}})

    await cfg["collection"]().update_one(
        {"_id": vehicle["_id"]},
        {"$set": {"sequence_status": "running", "sequence_cursor": 0}},
    )
    await touch(project_id)
    return cfg["out"](await _get_owned(kind, vehicle_id, project_id))


async def _current_task(kind: VehicleKind, project_id: str, vehicle_id: str, cursor: int) -> dict | None:
    cfg = _KINDS[kind]
    return await db.tasks().find_one({
        "project_id": project_id,
        cfg["assigned_field"]: vehicle_id,
        "sequence_index": cursor,
    })


async def _sequence_length(kind: VehicleKind, project_id: str, vehicle_id: str) -> int:
    cfg = _KINDS[kind]
    return await db.tasks().count_documents({
        "project_id": project_id,
        cfg["assigned_field"]: vehicle_id,
        "sequence_index": {"$ne": None},
    })


async def complete_current(project_id: str, user_id: str, kind: VehicleKind, vehicle_id: str) -> BaseModel:
    await get_owned_doc(project_id, user_id)
    cfg = _KINDS[kind]
    vehicle = await _get_owned(kind, vehicle_id, project_id)
    if vehicle.get("sequence_status") not in ("running",):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No sequence task in progress")

    cursor = vehicle.get("sequence_cursor", 0)
    task = await _current_task(kind, project_id, vehicle_id, cursor)
    if not task:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No current sequence task")

    await db.tasks().update_one({"_id": task["_id"]}, {"$set": {"status": "done"}})

    total = await _sequence_length(kind, project_id, vehicle_id)
    if vehicle.get("sequence_mode", "auto") == "manual":
        next_status = "held"
        next_cursor = cursor
    elif cursor + 1 >= total:
        next_status = "completed"
        next_cursor = cursor
    else:
        next_status = "running"
        next_cursor = cursor + 1

    await cfg["collection"]().update_one(
        {"_id": vehicle["_id"]},
        {"$set": {"sequence_status": next_status, "sequence_cursor": next_cursor}},
    )
    await touch(project_id)
    return cfg["out"](await _get_owned(kind, vehicle_id, project_id))


async def advance_sequence(project_id: str, user_id: str, kind: VehicleKind, vehicle_id: str) -> BaseModel:
    await get_owned_doc(project_id, user_id)
    cfg = _KINDS[kind]
    vehicle = await _get_owned(kind, vehicle_id, project_id)
    if vehicle.get("sequence_status") != "held":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sequence is not held")

    cursor = vehicle.get("sequence_cursor", 0)
    total = await _sequence_length(kind, project_id, vehicle_id)
    next_cursor = cursor + 1
    next_status = "completed" if next_cursor >= total else "running"

    await cfg["collection"]().update_one(
        {"_id": vehicle["_id"]},
        {"$set": {"sequence_status": next_status, "sequence_cursor": next_cursor}},
    )
    await touch(project_id)
    return cfg["out"](await _get_owned(kind, vehicle_id, project_id))


async def stop_sequence(project_id: str, user_id: str, kind: VehicleKind, vehicle_id: str) -> BaseModel:
    await get_owned_doc(project_id, user_id)
    cfg = _KINDS[kind]
    vehicle = await _get_owned(kind, vehicle_id, project_id)

    await db.tasks().update_many(
        {
            "project_id": project_id,
            cfg["assigned_field"]: vehicle_id,
            "sequence_index": {"$ne": None},
        },
        {"$set": {"sequence_index": None}},
    )
    await cfg["collection"]().update_one(
        {"_id": vehicle["_id"]},
        {"$set": {"sequence_status": "idle", "sequence_cursor": 0}},
    )
    await touch(project_id)
    return cfg["out"](await _get_owned(kind, vehicle_id, project_id))
