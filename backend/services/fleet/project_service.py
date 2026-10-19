from schemas.fleet.common import Dimension
from schemas.fleet.project import ProjectInit, ProjectOut
from services.fleet import db
from services.fleet.broker_service import ensure_broker
from services.fleet.environment_service import DEFAULT_SIZE, ensure
from services.fleet.ownership import get_owned_doc, touch


async def _out(project: dict, env: dict) -> ProjectOut:
    pid = str(project["_id"])
    return ProjectOut(
        id=pid,
        name=project.get("name", ""),
        dimension=env.get("dimension", Dimension.two_d.value),
        description=project.get("description") or "",
        created_at=project["created_at"],
        updated_at=project.get("updated_at", project["created_at"]),
        robot_count=await db.robots().count_documents({"project_id": pid}),
        task_count=await db.tasks().count_documents({"project_id": pid}),
    )


async def get_project(project_id: str, user_id: str) -> ProjectOut:
    project = await get_owned_doc(project_id, user_id)
    env = await ensure(project_id)
    return await _out(project, env)


async def init_project(project_id: str, user_id: str, body: ProjectInit) -> ProjectOut:
    await get_owned_doc(project_id, user_id)
    dimension = body.dimension.value
    env = await ensure(project_id, dimension)
    if env.get("dimension") != dimension:
        changes: dict = {"dimension": dimension}
        if body.dimension == Dimension.three_d and int(env.get("depth", 1)) <= 1:
            changes["depth"] = DEFAULT_SIZE
        elif body.dimension == Dimension.two_d:
            changes["depth"] = 1
        await db.environments().update_one({"project_id": project_id}, {"$set": changes})
    await ensure_broker(project_id, user_id)
    await touch(project_id)
    return await get_project(project_id, user_id)
