import argparse
import asyncio
import contextlib
import json
import sys

from bson import ObjectId
from bson.errors import InvalidId

from core.config import settings
from core.database import close_mongo_connection, connect_to_mongo
from services.fleet import db


async def list_projects() -> None:
    async for env in db.environments().find({}, {"project_id": 1, "dimension": 1}):
        pid = env["project_id"]
        try:
            project = await db.projects().find_one({"_id": ObjectId(pid)}, {"name": 1})
        except InvalidId:
            project = None
        robots = await db.robots().count_documents({"project_id": pid})
        name = project.get("name", "") if project else "(deleted)"
        print(f"{pid}  {env.get('dimension', '2d'):>2}  {robots:>3} robots  {name}", file=sys.stderr)


async def export(project_id: str, cell_size: float, origin: tuple[float, float]) -> dict:
    try:
        project = await db.projects().find_one({"_id": ObjectId(project_id)})
    except InvalidId:
        project = None
    if project is None:
        sys.exit(f"project {project_id} not found")

    env = await db.environments().find_one({"project_id": project_id}) or {}
    grid = env.get("obstacles") or []
    obstacles = [[col, row] for row, cells in enumerate(grid) for col, v in enumerate(cells) if v]

    robots = []
    async for r in db.robots().find({"project_id": project_id}):
        pos = r.get("position") or {}
        robots.append({
            "serial": r.get("serial_number") or str(r["_id"]),
            "manufacturer": r.get("manufacturer") or settings.FLEET_MANUFACTURER,
            "name": r.get("name", ""),
            "x": pos.get("x", 0.0),
            "y": pos.get("y", 0.0),
            "heading": r.get("heading", 0.0),
            "speed": r.get("speed", 1.0),
            "color": r.get("color"),
        })
    robots.sort(key=lambda r: r["serial"])

    return {
        "project_id": project_id,
        "name": project.get("name", ""),
        "cell_size_m": cell_size,
        "origin": list(origin),
        "width": env.get("width", len(grid[0]) if grid else 30),
        "height": env.get("height", len(grid) or 30),
        "obstacles": obstacles,
        "robots": robots,
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description="Export a Fleet project for the Blender sim")
    parser.add_argument("project_id", nargs="?", help="omit to list fleet projects")
    parser.add_argument("-o", "--out", help="write to a file instead of stdout")
    parser.add_argument("--cell-size", type=float, default=settings.FLEET_CELL_SIZE_M)
    parser.add_argument("--origin", type=float, nargs=2, metavar=("X", "Y"),
                        default=(settings.FLEET_MAP_ORIGIN_X, settings.FLEET_MAP_ORIGIN_Y))
    args = parser.parse_args()

    with contextlib.redirect_stdout(sys.stderr):
        await connect_to_mongo(settings.MONGODB_URI, settings.MONGODB_DB_NAME)
        try:
            if not args.project_id:
                await list_projects()
                return
            fleet = await export(args.project_id, args.cell_size, tuple(args.origin))
        finally:
            await close_mongo_connection()

    text = json.dumps(fleet, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
    else:
        print(text)
    print(f"exported {fleet['width']}x{fleet['height']} grid, {len(fleet['obstacles'])} obstacles, "
          f"{len(fleet['robots'])} robots", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
