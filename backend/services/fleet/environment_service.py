from schemas.fleet.common import Dimension
from schemas.fleet.environment import DEFAULT_BACKGROUND, EnvironmentOut, EnvironmentUpdate
from services.fleet import db
from services.fleet.ownership import get_owned_doc, touch

DEFAULT_SIZE = 30


def default_environment(project_id: str, dimension: str) -> dict:
    return {
        "project_id": project_id,
        "dimension": dimension,
        "width": DEFAULT_SIZE,
        "height": DEFAULT_SIZE,
        "depth": DEFAULT_SIZE if dimension == Dimension.three_d.value else 1,
        "obstacles": [[0] * DEFAULT_SIZE for _ in range(DEFAULT_SIZE)],
        "background": DEFAULT_BACKGROUND,
    }


async def ensure(project_id: str, dimension: str = Dimension.two_d.value) -> dict:
    doc = await db.environments().find_one({"project_id": project_id})
    if doc:
        doc.setdefault("background", DEFAULT_BACKGROUND)
        doc.setdefault("dimension", Dimension.two_d.value)
        return doc
    doc = default_environment(project_id, dimension)
    await db.environments().insert_one(doc)
    return doc


async def get_environment(project_id: str, user_id: str) -> EnvironmentOut:
    await get_owned_doc(project_id, user_id)
    return EnvironmentOut(**await ensure(project_id))


async def update_environment(project_id: str, user_id: str, body: EnvironmentUpdate) -> EnvironmentOut:
    await get_owned_doc(project_id, user_id)
    await ensure(project_id)
    changes = body.model_dump(exclude_unset=True)
    if changes:
        await db.environments().update_one({"project_id": project_id}, {"$set": changes})
        await touch(project_id)
    return EnvironmentOut(**await ensure(project_id))
