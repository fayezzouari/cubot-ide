import asyncio
from typing import List

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException, status

from core.auth import CurrentUser
from core.database import get_collection
from models.file import FileCreate, FileType, ProjectType
from models.project import ProjectCreate
from schemas.missions import CheckRequest, Mission, MissionRun, MissionStart, MissionSummary
from services.file_service import file_service
from services.missions import catalog, progress
from services.missions.ros_runner import run_ros_mission
from services.missions.runner import run_mission
from services.project_service import project_service

router = APIRouter(prefix="/missions", tags=["missions"])

_grading_slots = asyncio.Semaphore(4)
_ros_grading_slots = asyncio.Semaphore(8)

_FILE_TYPES = {
    ".ino": FileType.INO, ".cpp": FileType.CPP, ".c": FileType.C, ".h": FileType.H,
    ".py": FileType.PY, ".md": FileType.MD, ".txt": FileType.TXT, ".json": FileType.JSON,
}


def _mission_or_404(mission_id: str) -> Mission:
    mission = catalog.get_mission(mission_id)
    if not mission:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mission not found")
    return mission


async def _owned_project_exists(project_id: str, user_id: str) -> bool:
    try:
        oid = ObjectId(project_id)
    except (InvalidId, TypeError):
        return False
    return await get_collection("projects").count_documents({"_id": oid, "user_id": user_id}, limit=1) > 0


@router.get("/", response_model=List[MissionSummary])
async def list_missions(current_user: CurrentUser):
    entries = await progress.for_user(current_user["sub"])
    summaries = []
    for mission in catalog.all_missions():
        entry = entries.get(mission.id)
        summary = MissionSummary.model_validate(mission.model_dump(include=set(MissionSummary.model_fields)))
        if entry:
            summary.status = entry.status
            summary.project_id = entry.project_id
        summaries.append(summary)
    return summaries


@router.get("/{mission_id}", response_model=Mission)
async def get_mission(mission_id: str, current_user: CurrentUser):
    mission = _mission_or_404(mission_id).model_copy()
    entry = await progress.get(current_user["sub"], mission_id)
    if entry:
        mission.status = entry.status
        mission.project_id = entry.project_id
    return mission


@router.post("/{mission_id}/start", response_model=MissionStart)
async def start_mission(mission_id: str, current_user: CurrentUser):
    mission = _mission_or_404(mission_id)
    user_id = current_user["sub"]

    entry = await progress.get(user_id, mission_id)
    if entry and entry.project_id and await _owned_project_exists(entry.project_id, user_id):
        return MissionStart(project_id=entry.project_id, created=False)

    is_ros = mission.kind == "ros2"
    project = await project_service.create_project(
        ProjectCreate(
            name=f"Mission: {mission.title}",
            description=mission.summary,
            mission_id=mission.id,
            project_type=ProjectType.ROS if is_ros else ProjectType.EMBEDDED,
        ),
        user_id=user_id,
    )
    for starter in mission.starter_files:
        folder, _, name = starter.path.rpartition("/")
        suffix = name[name.rfind("."):] if "." in name else ""
        await file_service.create_file(FileCreate(
            name=name,
            path=(folder or "/") if is_ros else starter.path,
            content=starter.content,
            file_type=_FILE_TYPES.get(suffix, FileType.OTHER),
            project_id=project.id,
        ))
    await progress.mark_started(user_id, mission_id, project.id)
    return MissionStart(project_id=project.id, created=True)


@router.post("/{mission_id}/check", response_model=MissionRun)
async def check_mission(mission_id: str, body: CheckRequest, current_user: CurrentUser):
    mission = _mission_or_404(mission_id)
    if mission.kind == "ros2":
        if not body.project_id or not await _owned_project_exists(body.project_id, current_user["sub"]):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
        async with _ros_grading_slots:
            run = await run_ros_mission(mission, body.project_id)
    else:
        if not body.hex:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A compiled hex is required")
        async with _grading_slots:
            run = await run_mission(mission, body.hex)
    if run.error is None:
        await progress.record_attempt(current_user["sub"], mission_id, run.passed)
    return run
