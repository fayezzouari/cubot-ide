"""
CAD Studio orchestration: prompt → plan → parts (in parallel) → assembly,
part edits and parameter changes, imports and exports.

Long operations are async generators of progress events, streamed to the
browser as SSE. Geometry never travels in events: a built part is stored by
content key and the browser fetches its files (mesh.json for the viewer).
"""
import asyncio
import logging
import os
import re
from typing import AsyncGenerator, Awaitable, Callable, Optional

from core.config import settings
from services.cad import llm, prompts, repository as repo, storage
from services.cad.geometry import GeometryJobError, geometry

logger = logging.getLogger(__name__)

PALETTE = ["#8aa1b1", "#c08457", "#7f9c76", "#b48ead", "#d0b46c", "#6f8fbf", "#b07070", "#8c8c8c"]
IMPORT_KINDS = {
    ".step": "step", ".stp": "step",
    ".iges": "iges", ".igs": "iges",
    ".stl": "mesh", ".obj": "mesh", ".3mf": "mesh",
    ".dxf": "dxf",
}
EXPORT_FILES = {
    "step": ("assembly.step", "application/step"),
    "stl": ("assembly.stl", "model/stl"),
    "3mf": ("assembly.3mf", "model/3mf"),
    "glb": ("assembly.glb", "model/gltf-binary"),
    "stl-zip": ("parts-stl.zip", "application/zip"),
    "urdf": ("urdf-package.zip", "application/zip"),
}

Emit = Callable[[dict], Awaitable[None]]


class StudioError(Exception):
    pass


def _hex_to_rgb(color: Optional[str]) -> list[float]:
    if not color or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        return [0.7, 0.7, 0.7]
    return [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]


def _vec(v, default=(0.0, 0.0, 0.0)) -> list[float]:
    try:
        out = [float(x) for x in v][:3]
        return out if len(out) == 3 else list(default)
    except (TypeError, ValueError):
        return list(default)


# ── Serialisation ─────────────────────────────────────────────────────────


def version_view(v: dict, with_code: bool = True) -> dict:
    meta = v.get("meta") or {}
    view = {
        "id": v["_id"],
        "number": v["number"],
        "key": v["key"],
        "prompt": v.get("prompt"),
        "params": meta.get("params", {}),
        "bbox": meta.get("bbox"),
        "volume": meta.get("volume"),
        "valid": meta.get("valid"),
        "solids": meta.get("solids"),
        "faces": meta.get("faces"),
        "created_at": v["created_at"].isoformat() if v.get("created_at") else None,
    }
    if with_code:
        view["code"] = v.get("code")
    return view


def part_view(part: dict, version: Optional[dict]) -> dict:
    return {
        "id": part["_id"],
        "name": part["name"],
        "source": part["source"],
        "kind": part["kind"],
        "color": part["color"],
        "version": version_view(version) if version else None,
    }


async def state(project_id: str) -> dict:
    parts = await repo.list_parts(project_id)
    versions = await repo.get_versions([p["current_version"] for p in parts if p.get("current_version")])
    assembly = await repo.get_assembly(project_id)
    return {
        "parts": [part_view(p, versions.get(p.get("current_version"))) for p in parts],
        "assembly": {"name": assembly.get("name", "Assembly"), "instances": assembly.get("instances", [])},
    }


# ── Building ──────────────────────────────────────────────────────────────


def _asset_paths(assets: dict[str, str]) -> dict[str, str]:
    """{name: sha} → {name: path} for the runner."""
    return {name: storage.asset_path(sha, name) for name, sha in assets.items()}


async def build(code: str, params: dict, assets: dict[str, str]) -> tuple[str, dict]:
    """Build (or reuse) one part version; returns (content key, meta)."""
    key = storage.build_key(code, params, assets)
    cached = storage.cached_meta(key)
    if cached is not None:
        return key, cached
    meta = await geometry.run({
        "type": "build",
        "code": code,
        "params": params,
        "assets": _asset_paths(assets),
        "out_dir": storage.object_dir(key),
    })
    return key, meta


async def write_and_build(first_prompt: str, emit_retry: Callable[[int, str], Awaitable[None]],
                          assets: Optional[dict] = None) -> tuple[str, str, dict]:
    """Ask the model for code, build it, and feed errors back until it works.
    Returns (code, key, meta)."""
    answer = await llm.complete(prompts.CODE_SYSTEM, first_prompt)
    code = llm.extract_code(answer)
    error = "The model returned no code block"
    for attempt in range(1, settings.CAD_MAX_FIX_ATTEMPTS + 1):
        if code:
            try:
                key, meta = await build(code, {}, assets or {})
                return code, key, meta
            except GeometryJobError as e:
                error = str(e)
        if attempt == settings.CAD_MAX_FIX_ATTEMPTS:
            break
        await emit_retry(attempt + 1, error.splitlines()[0][:300])
        answer = await llm.complete(prompts.CODE_SYSTEM, prompts.fix_user(code or "", error))
        code = llm.extract_code(answer) or code
    raise StudioError(error)


# ── Generate from a prompt ────────────────────────────────────────────────


def _expand_plan(plan: dict) -> list[dict]:
    """Normalise the planner's JSON into parts with a list of placements."""
    parts = []
    seen = set()
    for i, raw in enumerate(plan.get("parts") or []):
        pid = re.sub(r"[^a-z0-9_]", "_", str(raw.get("id") or f"part_{i + 1}").lower())[:40] or f"part_{i + 1}"
        while pid in seen:
            pid += "_"
        seen.add(pid)
        positions = raw.get("positions") or [raw.get("position") or [0, 0, 0]]
        rotations = raw.get("rotations") or [raw.get("rotation") or [0, 0, 0]] * len(positions)
        placements = [
            {"position": _vec(p), "rotation": _vec(rotations[k] if k < len(rotations) else [0, 0, 0])}
            for k, p in enumerate(positions[:50])
        ]
        color = raw.get("color")
        parts.append({
            "id": pid,
            "name": str(raw.get("name") or pid.replace("_", " ").title())[:120],
            "description": str(raw.get("description") or raw.get("name") or ""),
            "placements": placements,
            "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
            else PALETTE[i % len(PALETTE)],
        })
    return parts[:8]


async def generate(project_id: str, owner: Optional[str], prompt: str) -> AsyncGenerator[dict, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: dict):
        await queue.put(event)

    async def run():
        try:
            await emit({"type": "planning"})
            existing = []
            current = await state(project_id)
            by_id = {p["id"]: p for p in current["parts"]}
            for inst in current["assembly"]["instances"]:
                p = by_id.get(inst["part_id"])
                if p and p["version"]:
                    existing.append({"name": inst["name"], "size": (p["version"]["bbox"] or {}).get("size"),
                                     "position": inst["position"]})
            try:
                plan = llm.extract_json(await llm.complete(
                    prompts.PLANNER_SYSTEM, prompts.planner_user(prompt, existing[:30]), max_tokens=3000,
                    temperature=0.1))
                parts = _expand_plan(plan)
            except Exception as e:
                logger.warning("[cad] planning failed (%s); building a single part", e)
                plan, parts = {}, []
            if not parts:
                parts = _expand_plan({"parts": [{"id": "model", "name": "Model", "description": prompt}]})
            overall = plan.get("name") or prompt
            if plan.get("name"):
                await repo.name_assembly_if_unnamed(project_id, owner, str(plan["name"]))
            await emit({"type": "plan", "name": overall,
                        "parts": [{"id": p["id"], "name": p["name"], "description": p["description"],
                                   "count": len(p["placements"])} for p in parts]})

            gate = asyncio.Semaphore(settings.CAD_PARALLEL_PARTS)

            async def make(spec: dict):
                async with gate:
                    await emit({"type": "part_started", "plan_id": spec["id"]})

                    async def retry(attempt: int, error: str):
                        await emit({"type": "part_retry", "plan_id": spec["id"], "attempt": attempt, "error": error})

                    try:
                        code, key, meta = await write_and_build(
                            prompts.part_user(spec["name"], spec["description"], overall), retry)
                    except Exception as e:
                        await emit({"type": "part_failed", "plan_id": spec["id"], "error": str(e)[:2000]})
                        return
                    part = await repo.create_part(project_id, owner, spec["name"], "generated", "brep", spec["color"])
                    version = await repo.add_version(part, code, {}, {}, prompt, key, meta)
                    instances = [
                        {"id": repo.new_id(), "part_id": part["_id"],
                         "name": spec["name"] if len(spec["placements"]) == 1 else f"{spec['name']} {k + 1}",
                         "position": pl["position"], "rotation": pl["rotation"], "color": None, "visible": True}
                        for k, pl in enumerate(spec["placements"])
                    ]
                    await repo.add_instances(project_id, owner, instances)
                    await emit({"type": "part_done", "plan_id": spec["id"], "part": part_view(part, version),
                                "instances": instances})

            await asyncio.gather(*(make(s) for s in parts))
            await emit({"type": "complete", "state": await state(project_id)})
        except Exception as e:
            logger.exception("[cad] generate failed")
            await emit({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event
    finally:
        if not task.done():
            task.cancel()


# ── Edit an existing part ─────────────────────────────────────────────────


async def _current(project_id: str, part_id: str) -> tuple[dict, dict]:
    part = await repo.get_part(project_id, part_id)
    if not part:
        raise StudioError("Part not found")
    version = await repo.get_version(part_id, part["current_version"]) if part.get("current_version") else None
    if not version:
        raise StudioError("Part has no version")
    return part, version


async def edit(project_id: str, part_id: str, instruction: str, face: Optional[dict]) -> AsyncGenerator[dict, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def run():
        try:
            part, version = await _current(project_id, part_id)
            await queue.put({"type": "part_started", "part_id": part_id})

            async def retry(attempt: int, error: str):
                await queue.put({"type": "part_retry", "part_id": part_id, "attempt": attempt, "error": error})

            # Parameter values the user set are kept by baking them into the new
            # version's overrides when the names still exist.
            code, key, meta = await write_and_build(
                prompts.edit_user(version["code"], instruction, version.get("meta"), face), retry,
                assets=version.get("assets") or {},
            )
            params = {k: v for k, v in (version.get("params") or {}).items() if k in (meta.get("params") or {})}
            if params:
                key, meta = await build(code, params, version.get("assets") or {})
            new = await repo.add_version(part, code, params, version.get("assets") or {}, instruction, key, meta)
            await queue.put({"type": "part_done", "part_id": part_id, "part": part_view(part, new)})
        except Exception as e:
            logger.warning("[cad] edit failed: %s", e)
            await queue.put({"type": "error", "message": str(e)[:2000]})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event
    finally:
        if not task.done():
            task.cancel()


async def set_params(project_id: str, part_id: str, params: dict) -> dict:
    part, version = await _current(project_id, part_id)
    declared = (version.get("meta") or {}).get("params") or {}
    clean = {}
    for name, value in params.items():
        spec = declared.get(name)
        if spec is None:
            continue
        if isinstance(spec["default"], bool):
            clean[name] = bool(value)
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise StudioError(f"{name} must be a number")
        if spec.get("min") is not None:
            value = max(float(spec["min"]), value)
        if spec.get("max") is not None:
            value = min(float(spec["max"]), value)
        clean[name] = value
    merged = {**(version.get("params") or {}), **clean}
    try:
        key, meta = await build(version["code"], merged, version.get("assets") or {})
    except GeometryJobError as e:
        raise StudioError(f"These values don't produce a valid part: {str(e).splitlines()[0]}")
    new = await repo.add_version(part, version["code"], merged, version.get("assets") or {},
                                 "Parameters: " + ", ".join(f"{k}={v:g}" if isinstance(v, float) else f"{k}={v}"
                                                            for k, v in clean.items()),
                                 key, meta)
    return part_view(part, new)


async def set_code(project_id: str, part_id: str, code: str) -> dict:
    part, version = await _current(project_id, part_id)
    try:
        key, meta = await build(code, {}, version.get("assets") or {})
    except GeometryJobError as e:
        raise StudioError(str(e))
    new = await repo.add_version(part, code, {}, version.get("assets") or {}, "Code edited by hand", key, meta)
    return part_view(part, new)


async def revert(project_id: str, part_id: str, version_id: str) -> dict:
    part = await repo.get_part(project_id, part_id)
    old = await repo.get_version(part_id, version_id) if part else None
    if not old:
        raise StudioError("Version not found")
    await repo.update_part(part_id, {"current_version": version_id})
    part["current_version"] = version_id
    return part_view(part, old)


async def versions(project_id: str, part_id: str) -> list[dict]:
    if not await repo.get_part(project_id, part_id):
        raise StudioError("Part not found")
    return [version_view(v, with_code=False) for v in await repo.list_versions(part_id)]


async def duplicate(project_id: str, owner: Optional[str], part_id: str) -> dict:
    part, version = await _current(project_id, part_id)
    copy = await repo.create_part(project_id, owner, f"{part['name']} copy", part["source"], part["kind"],
                                  part["color"])
    new = await repo.add_version(copy, version["code"], version.get("params") or {}, version.get("assets") or {},
                                 f"Copied from {part['name']}", version["key"], version.get("meta") or {})
    return part_view(copy, new)


async def delete(project_id: str, part_id: str) -> None:
    await repo.remove_part_instances(project_id, part_id)
    await repo.delete_part(project_id, part_id)


# ── Import ────────────────────────────────────────────────────────────────


async def import_file(project_id: str, owner: Optional[str], filename: str, data: bytes) -> dict:
    ext = os.path.splitext(filename)[1].lower()
    kind = IMPORT_KINDS.get(ext)
    if not kind:
        raise StudioError(f"Unsupported file type {ext or '(none)'}; use STEP, IGES, STL, OBJ, 3MF or DXF")
    sha, path = storage.save_asset(filename, data)
    asset_name = os.path.basename(path)
    code = prompts.imported_code(kind, asset_name)
    assets = {asset_name: sha}
    try:
        key, meta = await build(code, {}, assets)
    except GeometryJobError as e:
        raise StudioError(f"Could not import {filename}: {str(e).splitlines()[0]}")
    name = os.path.splitext(os.path.basename(filename))[0][:120] or "Imported part"
    parts_count = len(await repo.list_parts(project_id))
    part = await repo.create_part(project_id, owner, name, "imported", "mesh" if kind == "mesh" else "brep",
                                  PALETTE[parts_count % len(PALETTE)])
    version = await repo.add_version(part, code, {}, assets, f"Imported {filename}", key, meta)
    instance = {"id": repo.new_id(), "part_id": part["_id"], "name": name, "position": [0.0, 0.0, 0.0],
                "rotation": [0.0, 0.0, 0.0], "color": None, "visible": True}
    await repo.add_instances(project_id, owner, [instance])
    return {"part": part_view(part, version), "instance": instance}


# ── Export ────────────────────────────────────────────────────────────────


async def export(project_id: str, fmt: str, instance_ids: Optional[list[str]] = None) -> tuple[str, str, str]:
    """Returns (path, download filename, media type)."""
    assembly = await repo.get_assembly(project_id)
    parts = {p["_id"]: p for p in await repo.list_parts(project_id)}
    chosen = [
        i for i in assembly.get("instances", [])
        if (i["id"] in instance_ids if instance_ids else i.get("visible", True)) and i["part_id"] in parts
    ]
    if not chosen:
        raise StudioError("Nothing to export: the assembly has no visible parts")
    versions_by_id = await repo.get_versions([parts[i["part_id"]]["current_version"] for i in chosen])
    jobs = []
    for inst in chosen:
        part = parts[inst["part_id"]]
        version = versions_by_id.get(part["current_version"])
        step = storage.object_path(version["key"], "part.step") if version else None
        if not step:  # files were cleaned up: rebuild from the stored code
            try:
                key, _ = await build(version["code"], version.get("params") or {}, version.get("assets") or {})
            except GeometryJobError as e:
                raise StudioError(f"Could not rebuild {part['name']}: {str(e).splitlines()[0]}")
            step = storage.object_path(key, "part.step")
        jobs.append({
            "name": inst["name"],
            "step_path": step,
            "position": inst["position"],
            "rotation": inst["rotation"],
            "color": _hex_to_rgb(inst.get("color") or part["color"]),
        })
    filename, media = EXPORT_FILES[fmt]
    out_path = storage.new_export_path(filename)
    try:
        await geometry.run({
            "type": "assemble", "format": fmt, "name": assembly.get("name") or "assembly",
            "instances": jobs, "out_path": out_path,
        })
    except GeometryJobError as e:
        raise StudioError(f"Export failed: {e}")
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", assembly.get("name") or "assembly").strip("_") or "assembly"
    download = f"{base}-{filename}" if filename.endswith(".zip") else f"{base}{os.path.splitext(filename)[1]}"
    return out_path, download, media


# ── Projects from the previous CAD chat ───────────────────────────────────


async def migrate_legacy(project_id: str, owner: Optional[str]) -> None:
    """Bring the model from the old single-model CAD chat into the studio,
    once, the first time the project is opened here."""
    if await repo.list_parts(project_id):
        return
    code = await repo.legacy_session_code(project_id)
    if not code or "from part_" in code:  # the old multi-file plans can't run standalone
        return
    try:
        key, meta = await build(code, {}, {})
    except GeometryJobError:
        return
    part = await repo.create_part(project_id, owner, "Model", "generated", "brep", PALETTE[0])
    await repo.add_version(part, code, {}, {}, "Imported from the previous CAD chat", key, meta)
    await repo.add_instances(project_id, owner, [{
        "id": repo.new_id(), "part_id": part["_id"], "name": "Model", "position": [0.0, 0.0, 0.0],
        "rotation": [0.0, 0.0, 0.0], "color": None, "visible": True,
    }])
