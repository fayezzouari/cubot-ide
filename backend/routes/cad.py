import json
from typing import AsyncGenerator

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from core.auth import CurrentUser
from core.config import settings
from core.database import get_collection
from models.cad import (
    AssemblyUpdate,
    CaptureUpload,
    CodeRequest,
    EditRequest,
    ExportRequest,
    GenerateRequest,
    ParamsRequest,
    PartUpdate,
    RevertRequest,
    SnapshotRequest,
)
from services.cad import llm, repository as repo, storage, studio
from services.cad.studio import StudioError

router = APIRouter(prefix="/cad", tags=["cad"])

MEDIA = {"mesh.json": "application/json", "part.step": "application/step", "part.stl": "model/stl",
         "meta.json": "application/json"}


async def _project(project_id: str, user: dict) -> str:
    """The project must exist and belong to the caller."""
    try:
        doc = await get_collection("projects").find_one({"_id": ObjectId(project_id)}, {"user_id": 1})
    except InvalidId:
        doc = None
    if not doc or (doc.get("user_id") and doc["user_id"] != user.get("sub")):
        raise HTTPException(status_code=404, detail="Project not found")
    return project_id


def _sse(events: AsyncGenerator[dict, None]) -> StreamingResponse:
    async def stream():
        async for event in events:
            yield f"data: {json.dumps(event, default=str)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _fail(e: StudioError, status: int = 400):
    raise HTTPException(status_code=404 if "not found" in str(e).lower() else status, detail=str(e))


@router.get("/files/{key}/{name}")
async def get_file(key: str, name: str):
    """A built part's files. Keys are content hashes, so responses never change."""
    path = storage.object_path(key, name)
    if not path:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type=MEDIA[name], headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.get("/{project_id}")
async def get_state(project_id: str, user: CurrentUser):
    await _project(project_id, user)
    await studio.migrate_legacy(project_id, user.get("sub"))
    return await studio.state(project_id)


@router.post("/{project_id}/generate")
async def generate(project_id: str, body: GenerateRequest, user: CurrentUser):
    """Plan the request into parts, build them in parallel and add them to the
    assembly. Streams progress as Server-Sent Events."""
    await _project(project_id, user)
    return _sse(studio.generate(project_id, user.get("sub"), body.prompt,
                                view_image=llm.decode_view_image(body.view_image), owner=user.get("sub")))


@router.post("/{project_id}/parts/{part_id}/edit")
async def edit_part(project_id: str, part_id: str, body: EditRequest, user: CurrentUser):
    await _project(project_id, user)
    return _sse(studio.edit(project_id, part_id, body.instruction, body.face.model_dump() if body.face else None,
                            view_image=llm.decode_view_image(body.view_image), owner=user.get("sub")))


@router.post("/{project_id}/parts/{part_id}/params")
async def set_params(project_id: str, part_id: str, body: ParamsRequest, user: CurrentUser):
    await _project(project_id, user)
    try:
        return await studio.set_params(project_id, part_id, body.params)
    except StudioError as e:
        _fail(e, 422)


@router.put("/{project_id}/parts/{part_id}/code")
async def set_code(project_id: str, part_id: str, body: CodeRequest, user: CurrentUser):
    await _project(project_id, user)
    try:
        return await studio.set_code(project_id, part_id, body.code)
    except StudioError as e:
        _fail(e, 422)


@router.get("/{project_id}/parts/{part_id}/versions")
async def list_versions(project_id: str, part_id: str, user: CurrentUser):
    await _project(project_id, user)
    try:
        return await studio.versions(project_id, part_id)
    except StudioError as e:
        _fail(e)


@router.post("/{project_id}/parts/{part_id}/revert")
async def revert(project_id: str, part_id: str, body: RevertRequest, user: CurrentUser):
    await _project(project_id, user)
    try:
        return await studio.revert(project_id, part_id, body.version_id)
    except StudioError as e:
        _fail(e)


@router.post("/{project_id}/parts/{part_id}/duplicate")
async def duplicate(project_id: str, part_id: str, user: CurrentUser):
    await _project(project_id, user)
    try:
        return await studio.duplicate(project_id, user.get("sub"), part_id)
    except StudioError as e:
        _fail(e)


@router.patch("/{project_id}/parts/{part_id}")
async def update_part(project_id: str, part_id: str, body: PartUpdate, user: CurrentUser):
    await _project(project_id, user)
    if not await repo.get_part(project_id, part_id):
        raise HTTPException(status_code=404, detail="Part not found")
    fields = body.model_dump(exclude_none=True)
    if fields:
        await repo.update_part(part_id, fields)
    return {"ok": True}


@router.delete("/{project_id}/parts/{part_id}", status_code=204)
async def delete_part(project_id: str, part_id: str, user: CurrentUser):
    await _project(project_id, user)
    await studio.delete(project_id, part_id)


@router.put("/{project_id}/assembly")
async def save_assembly(project_id: str, body: AssemblyUpdate, user: CurrentUser):
    await _project(project_id, user)
    known = {p["_id"] for p in await repo.list_parts(project_id)}
    instances = [i.model_dump() for i in body.instances if i.part_id in known]
    doc = await repo.save_assembly(project_id, user.get("sub"), body.name, instances)
    return {"name": doc.get("name", "Assembly"), "instances": doc.get("instances", [])}


@router.post("/{project_id}/import")
async def import_file(project_id: str, user: CurrentUser, file: UploadFile = File(...)):
    await _project(project_id, user)
    limit = settings.CAD_MAX_UPLOAD_MB * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.CAD_MAX_UPLOAD_MB} MB")
    try:
        return await studio.import_file(project_id, user.get("sub"), file.filename or "upload", data)
    except StudioError as e:
        _fail(e, 422)


@router.post("/{project_id}/export")
async def export(project_id: str, body: ExportRequest, user: CurrentUser):
    await _project(project_id, user)
    try:
        path, filename, media = await studio.export(project_id, body.format, body.instance_ids)
    except StudioError as e:
        _fail(e, 422)
    return FileResponse(path, media_type=media, filename=filename)


@router.post("/{project_id}/parts/{part_id}/restore")
async def restore_part(project_id: str, part_id: str, user: CurrentUser):
    """Bring a deleted part back from the trash, with its copies."""
    await _project(project_id, user)
    try:
        return await studio.restore_part(project_id, user.get("sub"), part_id)
    except StudioError as e:
        _fail(e)


@router.get("/{project_id}/trash")
async def list_trash(project_id: str, user: CurrentUser):
    await _project(project_id, user)
    return await studio.trash(project_id)


@router.get("/{project_id}/snapshots")
async def list_snapshots(project_id: str, user: CurrentUser):
    await _project(project_id, user)
    return await studio.snapshots(project_id)


@router.post("/{project_id}/snapshots")
async def save_snapshot(project_id: str, body: SnapshotRequest, user: CurrentUser):
    await _project(project_id, user)
    try:
        return await studio.save_snapshot(project_id, body.label)
    except StudioError as e:
        _fail(e, 422)


@router.post("/{project_id}/snapshots/{snapshot_id}/restore")
async def restore_snapshot(project_id: str, snapshot_id: str, user: CurrentUser):
    """Restore the assembly and part versions; the current state is
    snapshotted first."""
    await _project(project_id, user)
    try:
        return await studio.restore_snapshot(project_id, user.get("sub"), snapshot_id)
    except StudioError as e:
        _fail(e)


@router.delete("/{project_id}/snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(project_id: str, snapshot_id: str, user: CurrentUser):
    await _project(project_id, user)
    await repo.delete_snapshot(project_id, snapshot_id)


@router.get("/{project_id}/messages")
async def list_messages(project_id: str, user: CurrentUser):
    """The assistant conversation for this project."""
    await _project(project_id, user)
    return await studio.messages(project_id)


@router.delete("/{project_id}/messages", status_code=204)
async def clear_messages(project_id: str, user: CurrentUser):
    await _project(project_id, user)
    await repo.clear_messages(project_id)


@router.post("/{project_id}/captures/{request_id}")
async def post_capture(project_id: str, request_id: str, body: CaptureUpload, user: CurrentUser):
    """Screenshots the open viewer took for a review round (see the `capture` event)."""
    await _project(project_id, user)
    if not studio.deliver_capture(project_id, request_id, [i.model_dump() for i in body.images]):
        raise HTTPException(status_code=404, detail="No review is waiting for these screenshots")
    return {"ok": True}
