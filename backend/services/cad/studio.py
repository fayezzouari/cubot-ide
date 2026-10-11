"""
CAD Studio orchestration: prompt → plan → parts (in parallel) → assembly,
part edits and parameter changes, imports and exports.

Long operations are async generators of progress events, streamed to the
browser as SSE. Geometry never travels in events: a built part is stored by
content key and the browser fetches its files (mesh.json for the viewer).
"""
import asyncio
import logging
import math
import os
import re
from datetime import timezone
from typing import AsyncGenerator, Awaitable, Callable, Optional

from core.config import settings
from services.cad import agents, llm, prompts, repository as repo, storage
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


def _iso(dt) -> Optional[str]:
    """ISO time in UTC with an explicit zone (Mongo returns naive UTC datetimes)."""
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


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
        "created_at": _iso(v.get("created_at")),
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


async def develop(brief: str, fallback_prompt: str, emit_retry: Callable[[int, str], Awaitable[None]],
                  notify: Callable[[str, str], Awaitable[None]], envelope: Optional[list] = None,
                  assets: Optional[dict] = None) -> tuple[str, str, dict]:
    """Have a part agent design and verify a part; without a tool-capable
    model, fall back to one-shot writing with error feedback."""
    async def build_code(code: str) -> tuple[str, dict]:
        return await build(code, {}, assets or {})

    try:
        code, key, meta, _ = await agents.run_part_agent(brief, build_code, notify, envelope)
        return code, key, meta
    except llm.ToolsUnsupported:
        return await write_and_build(fallback_prompt, emit_retry, assets=assets)
    except agents.AgentFailed as e:
        raise StudioError(str(e))


# ── Generate from a prompt ────────────────────────────────────────────────


SIDES = {"top", "bottom", "left", "right", "front", "back"}


def _expand_plan(plan: dict) -> list[dict]:
    """Normalise the planner's JSON: ids, colours and one placement per copy
    ({rotation, attach}); older answers with plain positions still work."""
    parts = []
    seen = set()
    for i, raw in enumerate(plan.get("parts") or []):
        pid = re.sub(r"[^a-z0-9_]", "_", str(raw.get("id") or f"part_{i + 1}").lower())[:40] or f"part_{i + 1}"
        while pid in seen:
            pid += "_"
        seen.add(pid)
        copies = raw.get("copies")
        if not isinstance(copies, list) or not copies:
            positions = raw.get("positions") or [raw.get("position") or [0, 0, 0]]
            rotations = raw.get("rotations") or [raw.get("rotation") or [0, 0, 0]] * len(positions)
            copies = [{"position": p, "rotation": rotations[k] if k < len(rotations) else [0, 0, 0]}
                      for k, p in enumerate(positions)]
        placements = []
        for c in copies[:50]:
            if not isinstance(c, dict):
                continue
            attach = c.get("attach") if isinstance(c.get("attach"), dict) else None
            if attach:
                side = str(attach.get("side") or "top").lower()
                offset = attach.get("offset") if isinstance(attach.get("offset"), list) else [0, 0]
                try:
                    gap = float(attach.get("gap") or 0)
                except (TypeError, ValueError):
                    gap = 0.0
                attach = {
                    "to": str(attach.get("to") or "ground"),
                    "side": side if side in SIDES else "top",
                    "offset": (_vec(list(offset) + [0], (0, 0, 0)))[:2],
                    "gap": gap,
                }
            placements.append({
                "position": _vec(c.get("position")),
                "rotation": _vec(c.get("rotation")),
                "attach": attach,
            })
        color = raw.get("color")
        envelope = raw.get("envelope")
        parts.append({
            "id": pid,
            "name": str(raw.get("name") or pid.replace("_", " ").title())[:120],
            "description": str(raw.get("description") or raw.get("name") or ""),
            "role": str(raw.get("role") or "")[:300],
            "envelope": _vec(envelope) if isinstance(envelope, list) else None,
            "features": [str(f)[:400] for f in (raw.get("features") or []) if f][:20],
            "checks": [str(c)[:300] for c in (raw.get("checks") or []) if c][:12],
            "interfaces": [str(i) for i in (raw.get("interfaces") or [])][:20],
            "placements": placements or [{"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "attach": None}],
            "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
            else PALETTE[i % len(PALETTE)],
        })
    return parts[:8]


def _rotate(v: list[float], rot_deg: list[float]) -> list[float]:
    """R = Rx·Ry·Rz (Euler XYZ, degrees), the convention the runner and viewer use."""
    rx, ry, rz = (math.radians(a) for a in rot_deg)
    x, y, z = v
    # Rz, then Ry, then Rx (applied right to left).
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    return [x, y, z]


async def _rest_on_ground(project_id: str, owner: Optional[str]) -> None:
    """Shift a freshly generated assembly so its lowest point sits on z = 0
    (the planner's placements are relative; this fixes their height)."""
    current = await state(project_id)
    boxes = {p["id"]: (p["version"] or {}).get("bbox") for p in current["parts"]}
    lowest = None
    for inst in current["assembly"]["instances"]:
        bbox = boxes.get(inst["part_id"])
        if not bbox:
            continue
        for cx in (bbox["min"][0], bbox["max"][0]):
            for cy in (bbox["min"][1], bbox["max"][1]):
                for cz in (bbox["min"][2], bbox["max"][2]):
                    z = _rotate([cx, cy, cz], inst["rotation"])[2] + inst["position"][2]
                    lowest = z if lowest is None else min(lowest, z)
    if lowest is None or abs(lowest) < 0.01:
        return
    instances = current["assembly"]["instances"]
    for inst in instances:
        inst["position"][2] = round(inst["position"][2] - lowest, 3)
    await repo.save_assembly(project_id, owner, None, instances)


def _rotated_box(bbox: dict, rotation: list[float]) -> tuple[list[float], list[float]]:
    """Bounds of the part's box after rotating it about its origin."""
    corners = [
        _rotate([x, y, z], rotation)
        for x in (bbox["min"][0], bbox["max"][0])
        for y in (bbox["min"][1], bbox["max"][1])
        for z in (bbox["min"][2], bbox["max"][2])
    ]
    return [min(c[k] for c in corners) for k in range(3)], [max(c[k] for c in corners) for k in range(3)]


# side → (normal axis, direction, the two in-face axes the offset runs along)
_FACES = {
    "top": (2, 1, (0, 1)), "bottom": (2, -1, (0, 1)),
    "right": (0, 1, (1, 2)), "left": (0, -1, (1, 2)),
    "back": (1, 1, (0, 2)), "front": (1, -1, (0, 2)),
}


def _solve_placements(built: dict[str, dict]) -> dict[str, list[float]]:
    """Positions for every instance whose plan says what it attaches to.

    Works on bounding boxes: the part (after its rotation) is put against
    the chosen face of its target's world box, outside it, centred on the
    face plus the offset. Targets are solved first; cycles and unknown
    targets fall back to the planner's position."""
    copies: dict[str, list[dict]] = {pid: b["instances"] for pid, b in built.items()}
    world: dict[str, tuple[list[float], list[float]]] = {}  # instance id → world box
    positions: dict[str, list[float]] = {}

    def target_instance(ref: str) -> Optional[dict]:
        pid, _, idx = ref.partition("#")
        group = copies.get(pid)
        if not group:
            return None
        k = int(idx) - 1 if idx.isdigit() else 0
        return group[min(max(k, 0), len(group) - 1)]

    def solve(pid: str, k: int, stack: tuple = ()) -> None:
        inst = copies[pid][k]
        if inst["id"] in world:
            return
        b = built[pid]
        placement = b["spec"]["placements"][k] if k < len(b["spec"]["placements"]) else {}
        rot = inst["rotation"]
        rlo, rhi = _rotated_box(b["meta"]["bbox"], rot)
        pos = list(inst["position"])
        attach = placement.get("attach")
        if attach and attach["to"] == "ground":
            a, c = attach["offset"]
            pos = [a - (rlo[0] + rhi[0]) / 2, c - (rlo[1] + rhi[1]) / 2, -rlo[2] + attach["gap"]]
        elif attach:
            target = target_instance(attach["to"])
            tpid = attach["to"].partition("#")[0]
            if target is not None and target["id"] != inst["id"] and inst["id"] not in stack:
                tk = copies[tpid].index(target)
                solve(tpid, tk, stack + (inst["id"],))
                tlo, thi = world[target["id"]]
                axis, direction, (u, v) = _FACES[attach["side"]]
                if direction > 0:
                    pos[axis] = thi[axis] + attach["gap"] - rlo[axis]
                else:
                    pos[axis] = tlo[axis] - attach["gap"] - rhi[axis]
                for along, off in ((u, attach["offset"][0]), (v, attach["offset"][1])):
                    pos[along] = (tlo[along] + thi[along]) / 2 + off - (rlo[along] + rhi[along]) / 2
        world[inst["id"]] = ([rlo[i] + pos[i] for i in range(3)], [rhi[i] + pos[i] for i in range(3)])
        positions[inst["id"]] = [round(v, 3) for v in pos]

    for pid, group in copies.items():
        for k in range(len(group)):
            solve(pid, k)
    return positions


async def _place(project_id: str, owner: Optional[str], built: dict[str, dict]) -> None:
    """Solve attachments and store each instance's position and rotation."""
    positions = _solve_placements(built)
    placed = {i["id"]: i for b in built.values() for i in b["instances"]}
    for iid, pos in positions.items():
        placed[iid]["position"] = pos
    assembly = await repo.get_assembly(project_id)
    instances = assembly.get("instances", [])
    for inst in instances:
        if inst["id"] in placed:
            inst["position"] = placed[inst["id"]]["position"]
            inst["rotation"] = placed[inst["id"]]["rotation"]
    await repo.save_assembly(project_id, owner, None, instances)


# ── Review (reflection after generation) ─────────────────────────────────


async def render_assembly(project_id: str) -> Optional[bytes]:
    """Four-view PNG of the visible assembly, drawn by the geometry worker."""
    current = await state(project_id)
    parts = {p["id"]: p for p in current["parts"]}
    jobs = []
    for inst in current["assembly"]["instances"]:
        part = parts.get(inst["part_id"])
        version = part and part["version"]
        mesh = version and storage.object_path(version["key"], "mesh.json")
        if not inst.get("visible", True) or not mesh:
            continue
        jobs.append({"mesh_path": mesh, "position": inst["position"], "rotation": inst["rotation"],
                     "color": _hex_to_rgb(inst.get("color") or part["color"])})
    if not jobs:
        return None
    out = storage.new_export_path("review.png")
    await geometry.run({"type": "render", "instances": jobs, "out_path": out, "size": 360})
    with open(out, "rb") as f:
        return f.read()


def _severity(problems: list[str]) -> int:
    """Overlaps count most, then parts touching nothing, then uneven footing."""
    return sum(3 if "overlap" in p else 2 if "touches no" in p else 1 for p in problems)


def _geometry_facts(built: dict[str, dict]) -> tuple[str, list[str]]:
    """World box of every copy plus problems a person would spot: parts sunk
    into each other, parts touching nothing, and an uneven footprint."""
    boxes = []
    for pid, b in built.items():
        for k, inst in enumerate(b["instances"]):
            rlo, rhi = _rotated_box(b["meta"]["bbox"], inst["rotation"])
            lo = [rlo[i] + inst["position"][i] for i in range(3)]
            hi = [rhi[i] + inst["position"][i] for i in range(3)]
            boxes.append((f"{pid}#{k + 1}", lo, hi))
    lines = [f"- {n}: min {[round(v, 1) for v in lo]} max {[round(v, 1) for v in hi]}" for n, lo, hi in boxes]
    problems = []
    for i, (a, alo, ahi) in enumerate(boxes):
        touching = False
        for j, (b, blo, bhi) in enumerate(boxes):
            if i == j:
                continue
            overlap = [min(ahi[k], bhi[k]) - max(alo[k], blo[k]) for k in range(3)]
            if all(o > -0.5 for o in overlap):
                touching = True
            if j > i and all(o > 1.0 for o in overlap):
                vol = overlap[0] * overlap[1] * overlap[2]
                smaller = min(
                    (ahi[0] - alo[0]) * (ahi[1] - alo[1]) * (ahi[2] - alo[2]),
                    (bhi[0] - blo[0]) * (bhi[1] - blo[1]) * (bhi[2] - blo[2]),
                )
                if smaller > 0 and vol / smaller > 0.2:
                    problems.append(f"{a} and {b}: bounding boxes overlap by {[round(o, 1) for o in overlap]} mm")
        if not touching and len(boxes) > 1:
            problems.append(f"{a} touches no other part")
    if boxes:
        lowest = min(lo[2] for _, lo, _ in boxes)
        on_ground = [n for n, lo, _ in boxes if lo[2] - lowest < 0.5]
        near = [f"{n} ({lo[2] - lowest:.1f} mm up)" for n, lo, _ in boxes if 0.5 <= lo[2] - lowest < 15]
        if near:
            problems.append(f"Resting on the ground: {', '.join(on_ground)}; almost touching it: {', '.join(near)}")
    return "\n".join(lines), problems


async def _sync_positions(project_id: str, built: dict[str, dict]) -> None:
    """Copy stored positions (after grounding) back into the working set."""
    stored = {i["id"]: i for i in (await repo.get_assembly(project_id)).get("instances", [])}
    for b in built.values():
        for inst in b["instances"]:
            if inst["id"] in stored:
                inst["position"] = stored[inst["id"]]["position"]


async def review(project_id: str, owner: Optional[str], request: str, built: dict[str, dict],
                 emit: Emit, rounds: int, ground: bool, plan_parts: list[dict]) -> None:
    """Reflection: look at the finished assembly (a render plus measured
    geometry) against the request, then apply the fixes the reviewer asks
    for: re-attaching copies and editing part designs."""
    for round_no in range(1, rounds + 1):
        await emit({"type": "reviewing", "round": round_no})
        try:
            image = await render_assembly(project_id)
        except GeometryJobError as e:
            logger.warning("[cad] review render failed: %s", e)
            image = None
        facts, problems = _geometry_facts(built)
        parts = []
        for pid, b in built.items():
            params = {k: v["value"] for k, v in (b["meta"].get("params") or {}).items()}
            parts.append({
                "id": pid, "name": b["spec"]["name"], "description": b["spec"]["description"][:500],
                "size": b["meta"]["bbox"]["size"], "params": params,
                "copies": [{"rotation": inst["rotation"], "attach": pl.get("attach")}
                           for inst, pl in zip(b["instances"], b["spec"]["placements"])],
            })
        try:
            verdict = llm.extract_json(await llm.complete(
                prompts.REVIEW_SYSTEM, prompts.review_user(request, parts, facts, problems, image is not None),
                max_tokens=3000, temperature=0.1, images=[image] if image else None))
        except Exception as e:
            logger.warning("[cad] review failed: %s", e)
            await emit({"type": "review", "round": round_no, "ok": True, "issues": [], "fixed": 0,
                        "note": "Review skipped"})
            return
        issues = [str(i)[:300] for i in (verdict.get("issues") or [])][:10]
        edits = [e for e in (verdict.get("edits") or []) if isinstance(e, dict) and e.get("part") in built][:4]
        moves = [m for m in (verdict.get("attachments") or []) if isinstance(m, dict) and m.get("part") in built]
        missing = [p["name"] for p in plan_parts if p["id"] not in built]
        if missing:
            issues.append(f"Not built: {', '.join(missing)}")
        if not edits and not moves:
            if issues:
                await _say(emit, project_id, "assistant", "Review found:\n" + "\n".join(f"• {i}" for i in issues),
                           {"kind": "review"})
            await emit({"type": "review", "round": round_no, "ok": not missing and bool(verdict.get("ok", True)),
                        "issues": issues, "fixed": 0})
            return

        await repo.create_snapshot(project_id, "Before review fixes", auto=True)
        # Re-attach copies, but keep a move only if the measured checks don't get worse.
        _, before = _geometry_facts(built)
        saved = {pid: ([dict(p) for p in b["spec"]["placements"]], [list(i["rotation"]) for i in b["instances"]],
                       [list(i["position"]) for i in b["instances"]]) for pid, b in built.items()}
        for m in moves:
            b = built[m["part"]]
            k = int(m.get("copy") or 1) - 1
            if not 0 <= k < len(b["instances"]):
                continue
            fixed = _expand_plan({"parts": [{"id": m["part"], "copies": [m]}]})[0]["placements"][0]
            b["spec"]["placements"][k] = fixed
            b["instances"][k]["rotation"] = fixed["rotation"]
        if moves:
            trial = _solve_placements(built)
            for b in built.values():
                for inst in b["instances"]:
                    if inst["id"] in trial:
                        inst["position"] = trial[inst["id"]]
            _, after = _geometry_facts(built)
            if _severity(after) > _severity(before):
                logger.info("[cad] review moves rejected: %s → %s", before, after)
                for pid, (placements, rotations, positions) in saved.items():
                    built[pid]["spec"]["placements"] = placements
                    for inst, rot, pos in zip(built[pid]["instances"], rotations, positions):
                        inst["rotation"], inst["position"] = rot, pos
                issues.append("Suggested re-placement was rejected: it made parts overlap or float")
                moves = []

        # Redesign parts, in parallel.
        async def redesign(e: dict) -> bool:
            b = built[e["part"]]
            await emit({"type": "part_started", "plan_id": e["part"]})

            async def retry(attempt: int, error: str):
                await emit({"type": "part_retry", "plan_id": e["part"], "attempt": attempt, "error": error})

            async def notify(action: str, detail: str):
                await emit({"type": "agent", "plan_id": e["part"], "action": action, "detail": detail})

            instruction = str(e.get("instruction") or "")
            try:
                code, key, meta = await develop(
                    b["brief"] + "\n\n" + prompts.agent_revise(b["version"]["code"], instruction, None),
                    prompts.edit_user(b["version"]["code"], instruction, b["meta"], None),
                    retry, notify, b["spec"].get("envelope"))
            except Exception as err:
                await emit({"type": "part_failed", "plan_id": e["part"], "error": str(err)[:500]})
                return False
            b["version"] = await repo.add_version(b["part"], code, {}, {}, f"Review: {e.get('instruction')}",
                                                  key, meta)
            b["meta"] = meta
            await emit({"type": "part_done", "plan_id": e["part"], "part": part_view(b["part"], b["version"])})
            return True

        results = await asyncio.gather(*(redesign(e) for e in edits))
        await _place(project_id, owner, built)
        if ground:
            await _rest_on_ground(project_id, owner)
        await _sync_positions(project_id, built)
        await emit({"type": "state", "state": await state(project_id)})
        fixed = sum(results) + len(moves)
        await _say(emit, project_id, "assistant",
                   f"Review fixed {fixed} issue{'s' if fixed != 1 else ''}:\n" + "\n".join(f"• {i}" for i in issues),
                   {"kind": "review"})
        await emit({"type": "review", "round": round_no, "ok": False, "issues": issues, "fixed": fixed})


async def generate(project_id: str, owner: Optional[str], prompt: str) -> AsyncGenerator[dict, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: dict):
        await queue.put(event)

    async def run():
        try:
            await _say(emit, project_id, "user", prompt, {"kind": "generate"})
            await repo.create_snapshot(project_id, f"Before: {prompt[:60]}", auto=True)
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
                    prompts.PLANNER_SYSTEM, prompts.planner_user(prompt, existing[:30]), max_tokens=8000,
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
            interfaces = {
                str(k): v if isinstance(v, dict) else {"value": v}
                for k, v in (plan.get("interfaces") or {}).items()
            } if isinstance(plan.get("interfaces"), dict) else {}
            await emit({"type": "plan", "name": overall, "summary": plan.get("summary"),
                        "interfaces": {k: v.get("value") for k, v in interfaces.items()},
                        "parts": [{"id": p["id"], "name": p["name"], "description": p["description"],
                                   "features": p["features"], "count": len(p["placements"])} for p in parts]})

            gate = asyncio.Semaphore(settings.CAD_PARALLEL_PARTS)

            async def make(spec: dict):
                async with gate:
                    await emit({"type": "part_started", "plan_id": spec["id"]})

                    async def retry(attempt: int, error: str):
                        await emit({"type": "part_retry", "plan_id": spec["id"], "attempt": attempt, "error": error})

                    async def notify(action: str, detail: str):
                        await emit({"type": "agent", "plan_id": spec["id"], "action": action, "detail": detail})

                    siblings = [{"name": o["name"], "description": o["description"]} for o in parts if o is not spec]
                    try:
                        code, key, meta = await develop(
                            prompts.agent_brief(spec, interfaces, overall, siblings),
                            prompts.part_user(spec["name"], spec["description"] + "\n" + "\n".join(spec["features"]),
                                              overall),
                            retry, notify, spec.get("envelope"))
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
                    built[spec["id"]] = {"spec": spec, "meta": meta, "instances": instances,
                                         "part": part, "version": version,
                                         "brief": prompts.agent_brief(spec, interfaces, overall, siblings)}
                    await emit({"type": "part_done", "plan_id": spec["id"], "part": part_view(part, version),
                                "instances": instances})

            built: dict[str, dict] = {}
            await asyncio.gather(*(make(s) for s in parts))
            # Parts that failed (usually rate limits) get one more go, one at a time.
            for spec in [p for p in parts if p["id"] not in built]:
                await make(spec)
            if built:
                await _place(project_id, owner, built)
            if not existing:
                await _rest_on_ground(project_id, owner)
            if built and settings.CAD_REVIEW_ROUNDS > 0:
                await _sync_positions(project_id, built)
                await emit({"type": "state", "state": await state(project_id)})
                await review(project_id, owner, prompt, built, emit, settings.CAD_REVIEW_ROUNDS,
                             ground=not existing, plan_parts=parts)
            names = [b["spec"]["name"] for b in built.values()]
            failed = [p["name"] for p in parts if p["id"] not in built]
            summary = (f"Added {len(names)} part{'s' if len(names) != 1 else ''} to {overall}: {', '.join(names)}."
                       if names else "No parts were built.")
            if failed:
                summary += f" Couldn't build: {', '.join(failed)}."
            await _say(emit, project_id, "assistant", summary,
                       {"kind": "generate", "parts": [b["part"]["_id"] for b in built.values()]})
            await emit({"type": "complete", "state": await state(project_id)})
        except asyncio.CancelledError:
            await repo.add_message(project_id, "assistant", "Stopped.")
            raise
        except Exception as e:
            logger.exception("[cad] generate failed")
            await _say(emit, project_id, "error", str(e)[:2000])
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

    async def emit(event: dict):
        await queue.put(event)

    async def run():
        try:
            part, version = await _current(project_id, part_id)
            await _say(emit, project_id, "user", instruction,
                       {"kind": "edit", "part": part_id, "part_name": part["name"],
                        "face": (face or {}).get("type")})
            await queue.put({"type": "part_started", "part_id": part_id})

            async def retry(attempt: int, error: str):
                await queue.put({"type": "part_retry", "part_id": part_id, "attempt": attempt, "error": error})

            # Parameter values the user set are kept by baking them into the new
            # version's overrides when the names still exist.
            async def notify(action: str, detail: str):
                await queue.put({"type": "agent", "part_id": part_id, "action": action, "detail": detail})

            brief = (f"Part: {part['name']}\nCurrent bounding box: {(version.get('meta') or {}).get('bbox')}\n\n"
                     + prompts.agent_revise(version["code"], instruction, face))
            code, key, meta = await develop(
                brief, prompts.edit_user(version["code"], instruction, version.get("meta"), face), retry, notify,
                assets=version.get("assets") or {},
            )
            params = {k: v for k, v in (version.get("params") or {}).items() if k in (meta.get("params") or {})}
            if params:
                key, meta = await build(code, params, version.get("assets") or {})
            new = await repo.add_version(part, code, params, version.get("assets") or {}, instruction, key, meta)
            await _say(emit, project_id, "assistant", f"Updated {part['name']} (v{new['number']}).",
                       {"kind": "edit", "part": part_id})
            await queue.put({"type": "part_done", "part_id": part_id, "part": part_view(part, new)})
        except asyncio.CancelledError:
            await repo.add_message(project_id, "assistant", "Stopped.")
            raise
        except Exception as e:
            logger.warning("[cad] edit failed: %s", e)
            await _say(emit, project_id, "error", str(e)[:2000])
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
    """Move a part to the trash, remembering its copies in the assembly."""
    assembly = await repo.get_assembly(project_id)
    copies = [i for i in assembly.get("instances", []) if i["part_id"] == part_id]
    await repo.remove_part_instances(project_id, part_id)
    await repo.trash_part(project_id, part_id, copies)


async def trash(project_id: str) -> list[dict]:
    parts = await repo.list_trash(project_id)
    versions = await repo.get_versions([p["current_version"] for p in parts if p.get("current_version")])
    return [
        {**part_view(p, versions.get(p.get("current_version"))),
         "deleted_at": _iso(p.get("deleted_at")),
         "copies": len(p.get("deleted_instances") or [])}
        for p in parts
    ]


async def restore_part(project_id: str, owner: Optional[str], part_id: str) -> dict:
    """Bring a part back from the trash, with its copies where they were."""
    trashed = await repo.get_part(project_id, part_id, include_deleted=True)
    if not trashed or not trashed.get("deleted_at"):
        raise StudioError("Part not found in the trash")
    copies = trashed.get("deleted_instances") or []
    part = await repo.untrash_part(project_id, part_id)
    if copies:
        await repo.add_instances(project_id, owner, copies)
    version = await repo.get_version(part_id, part["current_version"]) if part.get("current_version") else None
    return {"part": part_view(part, version), "instances": copies}


# ── Snapshots ─────────────────────────────────────────────────────────────


def snapshot_view(doc: dict) -> dict:
    return {
        "id": doc["_id"],
        "label": doc["label"],
        "auto": doc.get("auto", False),
        "created_at": _iso(doc["created_at"]),
        "copies": len(doc["assembly"].get("instances", [])),
        "parts": len(doc.get("versions", {})),
    }


async def snapshots(project_id: str) -> list[dict]:
    return [snapshot_view(d) for d in await repo.list_snapshots(project_id)]


async def save_snapshot(project_id: str, label: str) -> dict:
    doc = await repo.create_snapshot(project_id, label or "Snapshot", auto=False)
    if not doc:
        raise StudioError("Nothing to save: the assembly is empty")
    return snapshot_view(doc)


async def restore_snapshot(project_id: str, owner: Optional[str], snapshot_id: str) -> dict:
    """Put the assembly and each part's version back as they were. The
    current state is snapshotted first, so a restore can itself be undone."""
    snap = await repo.get_snapshot(project_id, snapshot_id)
    if not snap:
        raise StudioError("Snapshot not found")
    label = re.sub(r"^(Before restoring )+", "", snap["label"])
    await repo.create_snapshot(project_id, f"Before restoring {label}", auto=True)
    alive = set()
    for part_id, version_id in (snap.get("versions") or {}).items():
        part = await repo.get_part(project_id, part_id, include_deleted=True)
        if not part:
            continue  # permanently deleted since
        if part.get("deleted_at"):
            await repo.untrash_part(project_id, part_id)
        if version_id and await repo.get_version(part_id, version_id):
            await repo.update_part(part_id, {"current_version": version_id})
        alive.add(part_id)
    instances = [i for i in snap["assembly"].get("instances", []) if i["part_id"] in alive]
    await repo.save_assembly(project_id, owner, snap["assembly"].get("name"), instances)
    return await state(project_id)


# ── Assistant conversation ────────────────────────────────────────────────


def message_view(doc: dict) -> dict:
    return {"id": doc["_id"], "role": doc["role"], "text": doc["text"], "data": doc.get("data") or {},
            "created_at": _iso(doc["created_at"])}


async def messages(project_id: str) -> list[dict]:
    return [message_view(d) for d in await repo.list_messages(project_id)]


async def _say(emit: Emit, project_id: str, role: str, text: str, data: Optional[dict] = None) -> None:
    """Save a conversation message and send it to the browser."""
    doc = await repo.add_message(project_id, role, text, data)
    await emit({"type": "message", "message": message_view(doc)})


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
    legacy = await repo.legacy_session(project_id)
    if not legacy:
        return
    if legacy.get("messages") and not legacy.get("studio_migrated"):
        for m in legacy["messages"]:
            role = m.get("role") if m.get("role") in ("user", "assistant") else "assistant"
            await repo.add_message(project_id, role, str(m.get("content") or ""), {"kind": "legacy"})
        await repo.mark_legacy_migrated(project_id)
    if await repo.list_parts(project_id):
        return
    code = legacy.get("current_code")
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
