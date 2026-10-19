from services.fleet import db


async def current_sequence_task(
    vehicle_doc: dict, project_id: str, assigned_field: str
) -> dict | None:
    if vehicle_doc.get("sequence_status") != "running":
        return None
    return await db.tasks().find_one({
        "project_id": project_id,
        assigned_field: str(vehicle_doc["_id"]),
        "sequence_index": vehicle_doc.get("sequence_cursor", 0),
    })


async def complete_sequence_task(
    vehicle_collection, vehicle_doc: dict, project_id: str, assigned_field: str, task_doc: dict
) -> None:
    await db.tasks().update_one({"_id": task_doc["_id"]}, {"$set": {"status": "done"}})

    vehicle_id = str(vehicle_doc["_id"])
    cursor = vehicle_doc.get("sequence_cursor", 0)
    total = await db.tasks().count_documents({
        "project_id": project_id,
        assigned_field: vehicle_id,
        "sequence_index": {"$ne": None},
    })

    mode = vehicle_doc.get("sequence_mode", "auto")
    if mode == "manual":
        next_status, next_cursor = "held", cursor
    elif cursor + 1 >= total:
        next_status, next_cursor = "completed", cursor
    else:
        next_status, next_cursor = "running", cursor + 1

    await vehicle_collection.update_one(
        {"_id": vehicle_doc["_id"]},
        {"$set": {"sequence_status": next_status, "sequence_cursor": next_cursor}},
    )
