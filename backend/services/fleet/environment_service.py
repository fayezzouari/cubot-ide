from fastapi import HTTPException, status

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


def resize_grid(grid: list[list[int]], width: int, height: int) -> list[list[int]]:
    rows = [(list(row) + [0] * width)[:width] for row in grid[:height]]
    return rows + [[0] * width for _ in range(height - len(rows))]


async def _outside(project_id: str, width: int, height: int, depth: int, three_d: bool) -> list[str]:
    def out(pos: dict) -> bool:
        x, y, z = pos.get("x", 0.0), pos.get("y", 0.0), pos.get("z", 0.0)
        return x > width - 1 or y > height - 1 or (three_d and z > depth - 1)

    names = [r.get("name", "") async for r in db.robots().find({"project_id": project_id}) if out(r.get("position") or {})]
    names += [d.get("name", "") async for d in db.drones().find({"project_id": project_id}) if out(d.get("position") or {})]
    names += [
        t.get("name", "")
        async for t in db.tasks().find({"project_id": project_id, "status": {"$ne": "done"}})
        if out(t.get("position") or {})
    ]
    return names


async def update_environment(project_id: str, user_id: str, body: EnvironmentUpdate) -> EnvironmentOut:
    await get_owned_doc(project_id, user_id)
    current = await ensure(project_id)
    changes = body.model_dump(exclude_unset=True)
    if {"width", "height", "depth"} & changes.keys():
        width = changes.get("width") or current["width"]
        height = changes.get("height") or current["height"]
        depth = changes.get("depth") or current.get("depth", 1)
        three_d = current.get("dimension") == Dimension.three_d.value
        outside = await _outside(project_id, width, height, depth, three_d)
        if outside:
            size = f"{width}x{height}" + (f"x{depth}" if three_d else "")
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Move these inside {size} first: {', '.join(outside)}",
            )
        if "obstacles" not in changes:
            changes["obstacles"] = resize_grid(current.get("obstacles") or [], width, height)
    if changes:
        await db.environments().update_one({"project_id": project_id}, {"$set": changes})
        await touch(project_id)
    return EnvironmentOut(**await ensure(project_id))
