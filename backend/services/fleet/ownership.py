from datetime import datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from services.fleet import db


def _oid(project_id: str) -> ObjectId:
    try:
        return ObjectId(project_id)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")


async def get_owned_doc(project_id: str, user_id: str) -> dict:
    doc = await db.projects().find_one({"_id": _oid(project_id), "user_id": user_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return doc


async def touch(project_id: str) -> None:
    await db.projects().update_one({"_id": _oid(project_id)}, {"$set": {"updated_at": datetime.utcnow()}})
