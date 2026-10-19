from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from schemas.fleet.category import CategoryCreate, CategoryOut, CategoryUpdate
from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch


def _oid(category_id: str) -> ObjectId:
    try:
        return ObjectId(category_id)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")


async def _get_owned(category_id: str, project_id: str) -> dict:
    doc = await db.categories().find_one({"_id": _oid(category_id), "project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    return doc


async def list_categories(project_id: str, user_id: str) -> list[CategoryOut]:
    await get_owned_doc(project_id, user_id)
    cursor = db.categories().find({"project_id": project_id}).sort("name", 1)
    return [CategoryOut(**db.to_out(doc)) async for doc in cursor]


async def create_category(project_id: str, user_id: str, body: CategoryCreate) -> CategoryOut:
    await get_owned_doc(project_id, user_id)
    doc = {"project_id": project_id, "name": body.name, "color": body.color}
    res = await db.categories().insert_one(doc)
    doc["_id"] = res.inserted_id
    await touch(project_id)
    return CategoryOut(**db.to_out(doc))


async def update_category(project_id: str, category_id: str, user_id: str, body: CategoryUpdate) -> CategoryOut:
    await get_owned_doc(project_id, user_id)
    await _get_owned(category_id, project_id)
    changes = body.model_dump(exclude_unset=True)
    if changes:
        await db.categories().update_one({"_id": _oid(category_id)}, {"$set": changes})
        await touch(project_id)
    return CategoryOut(**db.to_out(await _get_owned(category_id, project_id)))


async def delete_category(project_id: str, category_id: str, user_id: str) -> None:
    await get_owned_doc(project_id, user_id)
    await _get_owned(category_id, project_id)
    await db.categories().delete_one({"_id": _oid(category_id)})
    await db.tasks().update_many(
        {"project_id": project_id},
        {"$pull": {"category_ids": category_id}},
    )
    await db.robots().update_many(
        {"project_id": project_id, "category_id": category_id},
        {"$set": {"category_id": None}},
    )
    await touch(project_id)
