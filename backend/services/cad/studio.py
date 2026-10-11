"""
CAD Studio orchestration: prompt → plan → parts (in parallel) → assembly,
part edits and parameter changes, imports and exports.

Long operations are async generators of progress events, streamed to the
browser as SSE. Geometry never travels in events: a built part is stored by
content key and the browser fetches its files (mesh.json for the viewer).
"""
import asyncio
import json
import logging
import os
import re
from datetime import timezone
from typing import AsyncGenerator, Awaitable, Callable, Optional

from core.config import settings
from services.cad import agents, assembly, fasteners, llm, prompts, repository as repo, storage
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
        "ports": meta.get("ports", {}),
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


async def build(code: str, params: dict, assets: dict[str, str], check_ports: bool = True) -> tuple[str, dict]:
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
        "check_ports": check_ports,
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
                  assets: Optional[dict] = None, required_ports: Optional[list[str]] = None,
                  images: Optional[list[tuple[bytes, str]]] = None) -> tuple[str, str, dict]:
    """Have a part agent design and verify a part; without a tool-capable
    model, fall back to one-shot writing with error feedback."""
    async def build_code(code: str) -> tuple[str, dict]:
        return await build(code, {}, assets or {})

    try:
        code, key, meta, _ = await agents.run_part_agent(brief, build_code, notify, envelope,
                                                         required_ports=required_ports, images=images)
        return code, key, meta
    except llm.ToolsUnsupported:
        return await write_and_build(fallback_prompt, emit_retry, assets=assets)
    except agents.AgentFailed as e:
        raise StudioError(str(e))


# ── Generate from a prompt ────────────────────────────────────────────────


SIDES = assembly.SIDES
MAX_CUSTOM_PARTS = 8
MAX_FASTENER_KINDS = 8


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
            mate = c.get("mate") if isinstance(c.get("mate"), dict) else None
            if mate:
                try:
                    gap = float(mate.get("gap") or 0)
                    angle = float(mate.get("angle") or 0)
                except (TypeError, ValueError):
                    gap, angle = 0.0, 0.0
                mate = {"port": str(mate.get("port") or ""), "to": str(mate.get("to") or "ground"),
                        "to_port": str(mate.get("to_port") or ""), "gap": gap, "angle": angle}
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
                "mate": mate,
                "attach": None if mate else attach,
            })
        color = raw.get("color")
        envelope = raw.get("envelope")
        fastener = fasteners.normalise(raw["fastener"]) if isinstance(raw.get("fastener"), dict) else None
        ports = [
            {"name": str(p.get("name")), "description": str(p.get("description") or "")[:300]}
            for p in (raw.get("ports") or []) if isinstance(p, dict) and p.get("name")
        ][:40]
        if fastener and not color:
            color = fasteners.COLORS[fastener["kind"]]
        parts.append({
            "fastener": fastener,
            "ports": ports,
            "id": pid,
            "name": str(raw.get("name") or pid.replace("_", " ").title())[:120],
            "description": str(raw.get("description") or raw.get("name") or ""),
            "role": str(raw.get("role") or "")[:300],
            "envelope": _vec(envelope) if isinstance(envelope, list) else None,
            "features": [str(f)[:400] for f in (raw.get("features") or []) if f][:20],
            "checks": [str(c)[:300] for c in (raw.get("checks") or []) if c][:12],
            "interfaces": [str(i) for i in (raw.get("interfaces") or [])][:20],
            "placements": placements or [{"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0],
                                          "mate": None, "attach": None}],
            "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
            else PALETTE[i % len(PALETTE)],
        })
    custom = [p for p in parts if not p["fastener"]][:MAX_CUSTOM_PARTS]
    hardware = [p for p in parts if p["fastener"]][:MAX_FASTENER_KINDS]
    keep = {id(p) for p in custom + hardware}
    return [p for p in parts if id(p) in keep]


async def _rest_on_ground(project_id: str, owner: Optional[str]) -> None:
    """Shift a freshly generated assembly so its lowest point sits on z = 0."""
    current = await state(project_id)
    boxes = {p["id"]: (p["version"] or {}).get("bbox") for p in current["parts"]}
    placed = [i for i in current["assembly"]["instances"] if boxes.get(i["part_id"])]
    # Copies mated to the ground define the floor; a screw poking out underneath doesn't.
    grounded = [i for i in placed if (i.get("mate") or {}).get("to") == "ground"]
    if grounded:
        return
    lows = [assembly.world_box(boxes[i["part_id"]], i["position"], i["rotation"])[0][2] for i in placed]
    if not lows or abs(min(lows)) < 0.01:
        return
    lowest = min(lows)
    instances = current["assembly"]["instances"]
    for inst in instances:
        inst["position"][2] = round(inst["position"][2] - lowest, 3)
    await repo.save_assembly(project_id, owner, None, instances)


def _apply(built: dict[str, dict], placements: dict) -> None:
    for b in built.values():
        for inst in b["instances"]:
            if inst["id"] in placements:
                inst["position"], inst["rotation"] = placements[inst["id"]]


async def _place(project_id: str, owner: Optional[str], built: dict[str, dict]) -> list[str]:
    """Solve the mates, store every copy's position and rotation, and return
    the mates that couldn't be resolved."""
    placements, problems = assembly.solve(built)
    _apply(built, placements)
    intent = {}
    for b in built.values():
        for k, inst in enumerate(b["instances"]):
            pl = b["spec"]["placements"][k] if k < len(b["spec"]["placements"]) else {}
            intent[inst["id"]] = (pl.get("mate"), pl.get("attach"))
    stored = await repo.get_assembly(project_id)
    instances = stored.get("instances", [])
    for inst in instances:
        if inst["id"] in placements:
            inst["position"], inst["rotation"] = placements[inst["id"]]
        if inst["id"] in intent:
            inst["mate"], inst["attach"] = intent[inst["id"]]
    await repo.save_assembly(project_id, owner, None, instances)
    return problems


def _slug(text: str, taken: set) -> str:
    base = re.sub(r"[^a-z0-9_]", "_", text.lower()).strip("_")[:40] or "part"
    out, k = base, 2
    while out in taken:
        out, k = f"{base}_{k}", k + 1
    taken.add(out)
    return out


async def _load_built(project_id: str, overall: str = "") -> dict[str, dict]:
    """The whole assembly as a working set keyed by each part's plan id:
    its spec (design intent), current build, copies with their mates and
    the brief its agent would get. Parts made before specs were stored get
    a minimal spec from what's known."""
    parts = await repo.list_parts(project_id)
    versions = await repo.get_versions([p["current_version"] for p in parts if p.get("current_version")])
    assembly_doc = await repo.get_assembly(project_id)
    interfaces = await repo.get_interfaces(project_id)
    taken: set = set()
    built: dict[str, dict] = {}
    for part in parts:
        version = versions.get(part.get("current_version"))
        if not version:
            continue
        copies = [i for i in assembly_doc.get("instances", []) if i["part_id"] == part["_id"]]
        if not copies:
            continue
        slug = part.get("slug") if part.get("slug") and part["slug"] not in taken else _slug(part["name"], taken)
        taken.add(slug)
        meta = version.get("meta") or {}
        spec = dict(part.get("spec") or {})
        spec.setdefault("description", part["name"])
        spec.setdefault("features", [])
        spec.setdefault("checks", [])
        spec.setdefault("interfaces", [])
        spec.setdefault("role", "")
        spec.setdefault("envelope", None)
        spec.setdefault("fastener", None)
        spec.setdefault("ports", [{"name": n, "description": ""} for n in (meta.get("ports") or {})])
        spec.update({"id": slug, "name": part["name"], "color": part["color"],
                     "placements": [{"position": i["position"], "rotation": i["rotation"],
                                     "mate": i.get("mate"), "attach": i.get("attach")} for i in copies]})
        built[slug] = {"spec": spec, "meta": meta, "instances": copies, "part": part, "version": version,
                       "brief": prompts.agent_brief(spec, interfaces, overall or assembly_doc.get("name", ""), [])}
    return built


def _describe_existing(slug: str, b: dict) -> dict:
    """What the planner needs to know about a part already in the assembly."""
    meta = b["meta"]
    return {
        "id": slug,
        "name": b["spec"]["name"],
        "role": b["spec"].get("role") or "",
        "description": (b["spec"].get("description") or "")[:300],
        "fastener": b["spec"].get("fastener"),
        "size": (meta.get("bbox") or {}).get("size"),
        "params": {k: v["value"] for k, v in (meta.get("params") or {}).items()},
        "ports": {n: {"origin": v["origin"], "axis": v["axis"]} for n, v in (meta.get("ports") or {}).items()},
        "copies": [{"mate": i.get("mate"), "position": i["position"]} for i in b["instances"]],
    }


def _spec_to_store(spec: dict) -> dict:
    keys = ("role", "description", "features", "checks", "interfaces", "ports", "envelope", "fastener")
    return {k: spec.get(k) for k in keys}


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


COLLISION_MM3 = 1.0  # shared volume that counts as a collision
CONTACT_MM = 0.3  # parts closer than this touch


def _severity(problems: list[str]) -> int:
    """Collisions count most, then broken mates and floating parts, then the rest."""
    return sum(3 if "collide" in p else 2 if ("apart" in p or "touches nothing" in p) else 1 for p in problems)


async def _check(built: dict[str, dict], mate_problems: list[str]) -> tuple[str, list[str]]:
    """Exact checks on the placed solids (geometry worker): every pair's
    shared volume and distance. Returns (world-box listing, problems):
    collisions, mates whose parts don't touch, parts touching nothing,
    plus mates that couldn't be resolved."""
    labels, jobs, mates = {}, [], []
    lines = []
    for pid, b in built.items():
        step = storage.object_path(b["version"]["key"], "part.step")
        for k, inst in enumerate(b["instances"]):
            labels[inst["id"]] = f"{pid}#{k + 1}"
            lo, hi = assembly.world_box(b["meta"]["bbox"], inst["position"], inst["rotation"])
            lines.append(f"- {pid}#{k + 1}: min {[round(v, 1) for v in lo]} max {[round(v, 1) for v in hi]}")
            if step:
                jobs.append({"id": inst["id"], "step_path": step, "position": inst["position"],
                             "rotation": inst["rotation"]})
            placement = b["spec"]["placements"][k] if k < len(b["spec"]["placements"]) else {}
            mate = placement.get("mate")
            if mate and mate["to"] != "ground":
                tpid, _, idx = mate["to"].partition("#")
                if tpid in built:
                    group = built[tpid]["instances"]
                    tk = min(max(int(idx) - 1 if idx.isdigit() else 0, 0), len(group) - 1)
                    mates.append((inst["id"], group[tk]["id"], mate))
    problems = list(mate_problems)
    if len(jobs) < 2:
        return "\n".join(lines), problems
    result = await geometry.run({"type": "check", "instances": jobs,
                                 "pairs": [[a, b] for a, b, _ in mates], "near": 1.0})
    by_pair = {tuple(sorted((p["a"], p["b"]))): p for p in result["pairs"]}
    for p in result["pairs"]:
        if p["overlap"] > COLLISION_MM3:
            problems.append(f"{labels[p['a']]} and {labels[p['b']]} collide: {p['overlap']:.1f} mm³ of shared volume")
    for a, b, mate in mates:
        p = by_pair.get(tuple(sorted((a, b))))
        if p and p["distance"] > CONTACT_MM + max(mate["gap"], 0):
            problems.append(f"{labels[a]} is mated to {labels[b]} ({mate['port']} → {mate['to_port']}) but they're "
                            f"{p['distance']:.1f} mm apart: a port isn't on the part's surface")
    lowest = min(result["lowest"].values())
    for iid, label in labels.items():
        touching = any(p["distance"] >= 0 and p["distance"] <= CONTACT_MM and iid in (p["a"], p["b"])
                       for p in result["pairs"])
        if not touching and result["lowest"].get(iid, lowest) - lowest > CONTACT_MM:
            problems.append(f"{label} touches nothing: it floats")
    grounded = [labels[i] for i, z in result["lowest"].items() if z - lowest <= CONTACT_MM]
    lines.append(f"Parts touching the ground (z = {lowest:.1f}): {', '.join(grounded)}")
    return "\n".join(lines), problems


async def _sync_positions(project_id: str, built: dict[str, dict]) -> None:
    """Copy stored positions (after grounding) back into the working set."""
    stored = {i["id"]: i for i in (await repo.get_assembly(project_id)).get("instances", [])}
    for b in built.values():
        for inst in b["instances"]:
            if inst["id"] in stored:
                inst["position"] = stored[inst["id"]]["position"]


async def review(project_id: str, owner: Optional[str], request: str, built: dict[str, dict],
                 emit: Emit, max_rounds: int, ground: bool, plan_parts: list[dict],
                 mate_problems: Optional[list[str]] = None) -> None:
    """Reflection loop: render the assembly, check it exactly (collisions,
    mates in contact, floating parts), let the reviewer judge it against the
    request and apply its fixes (re-mates and part redesigns by the part
    agents), then review again. It ends when the reviewer is satisfied and
    the exact checks pass, when it has no fix left, when two rounds in a row
    change nothing, or after `max_rounds`."""
    history: list[dict] = []  # what earlier rounds found and did, so fixes aren't undone
    fixed_total: list[str] = []
    idle_rounds = 0
    snapshotted = False
    outcome, remaining = "limit", []
    missing = [p["name"] for p in plan_parts if p["id"] not in built]
    mate_problems = list(mate_problems or [])

    for round_no in range(1, max_rounds + 1):
        await emit({"type": "reviewing", "round": round_no})
        try:
            image = await render_assembly(project_id)
        except GeometryJobError as e:
            logger.warning("[cad] review render failed: %s", e)
            image = None
        try:
            facts, problems = await _check(built, mate_problems)
        except GeometryJobError as e:
            logger.warning("[cad] exact check failed: %s", e)
            facts, problems = "(exact check unavailable)", list(mate_problems)
        parts = []
        for pid, b in built.items():
            params = {k: v["value"] for k, v in (b["meta"].get("params") or {}).items()}
            parts.append({
                "id": pid, "name": b["spec"]["name"], "description": b["spec"]["description"][:500],
                "size": b["meta"]["bbox"]["size"], "params": params,
                "ports": {n: {"origin": v["origin"], "axis": v["axis"]} for n, v in (b["meta"].get("ports") or {}).items()},
                "copies": [{"mate": pl.get("mate"), "attach": pl.get("attach"), "rotation": inst["rotation"]}
                           for inst, pl in zip(b["instances"], b["spec"]["placements"])],
            })
        try:
            verdict = llm.extract_json(await llm.complete(
                prompts.REVIEW_SYSTEM,
                prompts.review_user(request, parts, facts, problems, image is not None, history),
                max_tokens=4000, temperature=0.1, images=[image] if image else None))
        except Exception as e:
            logger.warning("[cad] review failed: %s", e)
            await emit({"type": "review", "round": round_no, "ok": True, "issues": [], "fixed": 0,
                        "note": "Review skipped"})
            outcome = "quota" if isinstance(e, llm.QuotaExceeded) else "error"
            remaining = [str(e)] if outcome == "quota" else problems
            break
        issues = [str(i)[:300] for i in (verdict.get("issues") or [])][:10]
        edits = [e for e in (verdict.get("edits") or []) if isinstance(e, dict) and e.get("part") in built][:4]
        moves = [m for m in (verdict.get("placements") or verdict.get("attachments") or [])
                 if isinstance(m, dict) and m.get("part") in built]

        if verdict.get("ok") and not edits and not moves:
            if not problems:
                await emit({"type": "review", "round": round_no, "ok": True, "issues": [], "fixed": 0,
                            "note": f"Review: satisfied (round {round_no})"})
                outcome = "satisfied"
                break
            # The reviewer is happy but the exact checks aren't: ask again with that on record.
            history.append({"round": round_no, "issues": problems, "applied": [],
                            "rejected": ["You answered ok, but these exact checks still fail; they must be fixed."]})
            await emit({"type": "review", "round": round_no, "ok": False, "issues": problems, "fixed": 0})
            idle_rounds += 1
            if idle_rounds >= 2:
                outcome, remaining = "stalled", problems
                break
            continue
        if not edits and not moves:
            # Problems it can't fix with re-mates or edits: nothing more to do.
            await emit({"type": "review", "round": round_no, "ok": False, "issues": issues + problems, "fixed": 0,
                        "note": "Review: no further fixes"})
            outcome, remaining = "stuck", issues + problems
            break

        if not snapshotted:
            await repo.create_snapshot(project_id, "Before review fixes", auto=True)
            snapshotted = True
        applied: list[str] = []
        rejected: list[str] = []

        # Re-mate copies, but keep the moves only if the exact checks don't get worse.
        before = problems
        saved = {pid: ([dict(p) for p in b["spec"]["placements"]], [list(i["rotation"]) for i in b["instances"]],
                       [list(i["position"]) for i in b["instances"]]) for pid, b in built.items()}
        described = []
        for m in moves:
            b = built[m["part"]]
            k = int(m.get("copy") or 1) - 1
            if not 0 <= k < len(b["instances"]):
                continue
            fixed = _expand_plan({"parts": [{"id": m["part"], "copies": [m]}]})[0]["placements"][0]
            b["spec"]["placements"][k] = fixed
            if fixed.get("attach"):
                b["instances"][k]["rotation"] = fixed["rotation"]
            how = fixed.get("mate") or fixed.get("attach") or {}
            described.append(f"re-placed {m['part']}#{k + 1}: {json.dumps(how)}")
        if described:
            trial, trial_problems = assembly.solve(built)
            _apply(built, trial)
            try:
                _, after = await _check(built, trial_problems)
            except GeometryJobError:
                after = before
            if _severity(after) > _severity(before):
                logger.info("[cad] review moves rejected: %s → %s", before, after)
                for pid, (placements, rotations, positions) in saved.items():
                    built[pid]["spec"]["placements"] = placements
                    for inst, rot, pos in zip(built[pid]["instances"], rotations, positions):
                        inst["rotation"], inst["position"] = rot, pos
                rejected += [f"{d}: rejected, it made the exact checks worse ({'; '.join(after[:3])})"
                             for d in described]
            else:
                applied += described

        # Redesign parts, in parallel, with their agents.
        async def redesign(e: dict) -> Optional[str]:
            b = built[e["part"]]
            await emit({"type": "part_started", "plan_id": e["part"]})

            async def retry(attempt: int, error: str):
                await emit({"type": "part_retry", "plan_id": e["part"], "attempt": attempt, "error": error})

            async def notify(action: str, detail: str):
                await emit({"type": "agent", "plan_id": e["part"], "action": action, "detail": detail})

            instruction = str(e.get("instruction") or "")
            try:
                if b["spec"].get("fastener"):
                    raise StudioError("standard fasteners are not redesigned; re-place them or change the plan")
                try:
                    before_render = await agents.render_part(b["version"]["key"])
                except GeometryJobError:
                    before_render = None
                code, key, meta = await develop(
                    b["brief"] + "\n\n" + prompts.agent_revise(b["version"]["code"], instruction, None),
                    prompts.edit_user(b["version"]["code"], instruction, b["meta"], None),
                    retry, notify, b["spec"].get("envelope"),
                    required_ports=[p["name"] for p in b["spec"].get("ports") or []],
                    images=[(before_render, PART_CAPTION)] if before_render else None)
            except Exception as err:
                await emit({"type": "part_failed", "plan_id": e["part"], "error": str(err)[:500]})
                rejected.append(f"edit {e['part']} ({instruction[:120]}): failed to build")
                return None
            b["version"] = await repo.add_version(b["part"], code, {}, {}, f"Review: {instruction}", key, meta)
            b["meta"] = meta
            await emit({"type": "part_done", "plan_id": e["part"], "part": part_view(b["part"], b["version"])})
            return f"edited {e['part']}: {instruction[:200]}"

        applied += [r for r in await asyncio.gather(*(redesign(e) for e in edits)) if r]
        mate_problems = await _place(project_id, owner, built)
        if ground:
            await _rest_on_ground(project_id, owner)
        await _sync_positions(project_id, built)
        await emit({"type": "state", "state": await state(project_id)})

        history.append({"round": round_no, "issues": issues, "applied": applied, "rejected": rejected})
        fixed_total += issues if applied else []
        await emit({"type": "review", "round": round_no, "ok": False, "issues": issues, "fixed": len(applied)})
        idle_rounds = 0 if applied else idle_rounds + 1
        if idle_rounds >= 2:
            outcome, remaining = "stalled", issues
            break
        remaining = issues

    rounds_done = len(history) + (1 if outcome in ("satisfied", "stuck") else 0)

    def bullets(items: list[str]) -> str:
        return "\n".join(f"• {i}" for i in items)

    if outcome == "satisfied":
        text = f"Review satisfied after {rounds_done} round{'s' if rounds_done != 1 else ''}."
        if fixed_total:
            text += f" Fixed along the way:\n{bullets(fixed_total)}"
    elif outcome in ("error", "quota"):
        text = ("The review stopped: " + remaining[0]) if outcome == "quota" else \
            "The review couldn't run; the assembly is as generated."
        if outcome == "error" and remaining:
            text += f"\nOpen exact-check problems:\n{bullets(remaining)}"
    else:
        why = {"stuck": "it found no further fixes", "stalled": "two rounds in a row changed nothing",
               "limit": f"it reached the limit of {max_rounds} rounds"}[outcome]
        text = f"Review stopped after {rounds_done} round{'s' if rounds_done != 1 else ''}: {why}."
        if fixed_total:
            text += f"\nFixed:\n{bullets(fixed_total)}"
        if remaining:
            text += f"\nStill open:\n{bullets(remaining)}"
    if missing:
        text += f"\nNot built: {', '.join(missing)}"
    await _say(emit, project_id, "assistant", text, {"kind": "review", "outcome": outcome, "rounds": rounds_done})


async def generate(project_id: str, owner: Optional[str], prompt: str,
                   view_image: Optional[bytes] = None) -> AsyncGenerator[dict, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: dict):
        await queue.put(event)

    async def run():
        try:
            await _say(emit, project_id, "user", prompt, {"kind": "generate"})
            await repo.create_snapshot(project_id, f"Before: {prompt[:60]}", auto=True)
            await emit({"type": "planning"})
            built = await _load_built(project_id)
            existing = [_describe_existing(slug, b) for slug, b in built.items()]
            try:
                # With parts already in the assembly, the planner also sees what the user sees.
                show = [view_image] if view_image and existing else None
                plan = llm.extract_json(await llm.complete(
                    prompts.PLANNER_SYSTEM,
                    prompts.planner_user(prompt, existing[:40]) + (
                        "\n\nThe attached image is the user's current 3D viewport (Z up)." if show else ""),
                    max_tokens=8000, temperature=0.1, images=show))
                parts = [p for p in _expand_plan(plan) if p["id"] not in built]
            except Exception as e:
                logger.warning("[cad] planning failed (%s); building a single part", e)
                plan, parts = {}, []
            updates = [u for u in (plan.get("update") or []) if isinstance(u, dict) and u.get("part") in built][:8]
            removals = [r for r in (plan.get("remove") or []) if r in built]
            remates = [m for m in (plan.get("placements") or []) if isinstance(m, dict) and m.get("part") in built]
            if not parts and not updates and not removals and not remates:
                if existing:
                    raise StudioError("The planner found nothing to change; try describing the change more precisely")
                parts = _expand_plan({"parts": [{"id": "model", "name": "Model", "description": prompt}]})
            overall = plan.get("name") or (await repo.get_assembly(project_id)).get("name") or prompt
            if plan.get("name"):
                await repo.name_assembly_if_unnamed(project_id, owner, str(plan["name"]))
            new_interfaces = {
                str(k): v if isinstance(v, dict) else {"value": v}
                for k, v in (plan.get("interfaces") or {}).items()
            } if isinstance(plan.get("interfaces"), dict) else {}
            await repo.merge_interfaces(project_id, new_interfaces)
            interfaces = await repo.get_interfaces(project_id)
            await emit({"type": "plan", "name": overall, "summary": plan.get("summary"),
                        "interfaces": {k: v.get("value") for k, v in interfaces.items()},
                        "parts": [{"id": u["part"], "name": f"Update {built[u['part']]['spec']['name']}",
                                   "description": str(u.get("instruction") or ""), "features": [], "count": 1}
                                  for u in updates]
                        + [{"id": p["id"], "name": p["name"], "description": p["description"],
                            "features": p["features"], "count": len(p["placements"])} for p in parts]})

            # Remove parts the change drops (to the trash, restorable).
            for slug in removals:
                await delete(project_id, built[slug]["part"]["_id"])
                built.pop(slug)

            gate = asyncio.Semaphore(settings.CAD_PARALLEL_PARTS)

            def hooks(plan_id: str):
                async def retry(attempt: int, error: str):
                    await emit({"type": "part_retry", "plan_id": plan_id, "attempt": attempt, "error": error})

                async def notify(action: str, detail: str):
                    await emit({"type": "agent", "plan_id": plan_id, "action": action, "detail": detail})
                return retry, notify

            # Update existing parts with their agents.
            async def update(u: dict):
                slug = u["part"]
                b = built[slug]
                async with gate:
                    await emit({"type": "part_started", "plan_id": slug})
                    retry, notify = hooks(slug)
                    instruction = str(u.get("instruction") or "")
                    spec = b["spec"]
                    for field in ("features", "checks"):
                        if isinstance(u.get(field), list):
                            spec[field] = [str(x)[:400] for x in u[field]][:20]
                    if isinstance(u.get("ports"), list):
                        known = {p["name"] for p in spec.get("ports") or []}
                        spec["ports"] = (spec.get("ports") or []) + [
                            {"name": str(p.get("name")), "description": str(p.get("description") or "")[:300]}
                            for p in u["ports"] if isinstance(p, dict) and p.get("name") not in known]
                    try:
                        if spec.get("fastener"):
                            raise StudioError("standard fasteners are replaced, not redesigned")
                        try:
                            before = await agents.render_part(b["version"]["key"])
                        except GeometryJobError:
                            before = None
                        images = ([(view_image, VIEW_CAPTION)] if view_image else []) + (
                            [(before, PART_CAPTION)] if before else [])
                        brief = (prompts.agent_brief(spec, interfaces, overall, [])
                                 + "\n\n" + prompts.agent_revise(b["version"]["code"], instruction, None))
                        code, key, meta = await develop(
                            brief, prompts.edit_user(b["version"]["code"], instruction, b["meta"], None),
                            retry, notify, spec.get("envelope"), images=images or None,
                            required_ports=[p["name"] for p in spec.get("ports") or []])
                    except Exception as e:
                        await emit({"type": "part_failed", "plan_id": slug, "error": str(e)[:2000]})
                        return
                    b["version"] = await repo.add_version(b["part"], code, b["version"].get("params") or {}, {},
                                                          instruction, key, meta)
                    b["meta"] = meta
                    b["brief"] = prompts.agent_brief(spec, interfaces, overall, [])
                    await repo.update_part(b["part"]["_id"], {"spec": _spec_to_store(spec)})
                    updated.append(slug)
                    await emit({"type": "part_done", "plan_id": slug, "part": part_view(b["part"], b["version"])})

            # Build new parts (agents, or templates for fasteners).
            async def make(spec: dict):
                async with gate:
                    await emit({"type": "part_started", "plan_id": spec["id"]})
                    retry, notify = hooks(spec["id"])
                    siblings = [{"name": o["name"], "description": o["description"]} for o in parts
                                if o is not spec and not o["fastener"]] + [
                        {"name": b["spec"]["name"], "description": b["spec"]["description"]}
                        for b in built.values() if not b["spec"].get("fastener")]
                    try:
                        if spec["fastener"]:
                            # Standard hardware: fixed template, no agent needed.
                            code = fasteners.code(spec["fastener"])
                            key, meta = await build(code, {}, {}, check_ports=False)
                        else:
                            code, key, meta = await develop(
                                prompts.agent_brief(spec, interfaces, overall, siblings),
                                prompts.part_user(spec["name"],
                                                  spec["description"] + "\n" + "\n".join(spec["features"]), overall),
                                retry, notify, spec.get("envelope"), required_ports=[p["name"] for p in spec["ports"]])
                    except Exception as e:
                        await emit({"type": "part_failed", "plan_id": spec["id"], "error": str(e)[:2000]})
                        return
                    if spec["fastener"]:
                        spec["name"] = fasteners.name(spec["fastener"])
                    part = await repo.create_part(project_id, owner, spec["name"], "generated", "brep", spec["color"],
                                                  slug=spec["id"], spec=_spec_to_store(spec))
                    version = await repo.add_version(part, code, {}, {}, prompt, key, meta)
                    instances = [
                        {"id": repo.new_id(), "part_id": part["_id"],
                         "name": spec["name"] if len(spec["placements"]) == 1 else f"{spec['name']} {k + 1}",
                         "position": pl["position"], "rotation": pl["rotation"], "color": None, "visible": True,
                         "mate": pl.get("mate"), "attach": pl.get("attach")}
                        for k, pl in enumerate(spec["placements"])
                    ]
                    await repo.add_instances(project_id, owner, instances)
                    built[spec["id"]] = {"spec": spec, "meta": meta, "instances": instances,
                                         "part": part, "version": version,
                                         "brief": prompts.agent_brief(spec, interfaces, overall, siblings)}
                    added.append(spec["id"])
                    await emit({"type": "part_done", "plan_id": spec["id"], "part": part_view(part, version),
                                "instances": instances})

            updated: list[str] = []
            added: list[str] = []
            await asyncio.gather(*(update(u) for u in updates))
            await asyncio.gather(*(make(s) for s in parts))
            # Parts that failed (usually rate limits) get one more go, one at a time.
            for spec in [p for p in parts if p["id"] not in built]:
                await make(spec)

            # Re-mate existing copies as planned.
            for m in remates:
                b = built[m["part"]]
                k = int(m.get("copy") or 1) - 1
                if 0 <= k < len(b["instances"]):
                    b["spec"]["placements"][k] = _expand_plan(
                        {"parts": [{"id": m["part"], "copies": [m]}]})[0]["placements"][0]

            mate_problems = await _place(project_id, owner, built) if built else []
            await _rest_on_ground(project_id, owner)

            changed = []
            if updated:
                changed.append(f"updated {', '.join(built[s]['spec']['name'] for s in updated)}")
            if added:
                changed.append(f"added {', '.join(built[s]['spec']['name'] for s in added)}")
            if removals:
                changed.append(f"removed {', '.join(removals)}")
            if remates:
                changed.append(f"re-placed {len(remates)} cop{'ies' if len(remates) != 1 else 'y'}")
            failed = [p["name"] for p in parts if p["id"] not in built] + [
                built[u["part"]]["spec"]["name"] for u in updates if u["part"] not in updated and u["part"] in built]
            summary = (f"{overall}: " + "; ".join(changed) + ".") if changed else "Nothing was changed."
            if failed:
                summary += f" Couldn't build: {', '.join(failed)}."
            await _say(emit, project_id, "assistant", summary,
                       {"kind": "generate", "added": added, "updated": updated, "removed": removals})
            if built and settings.CAD_REVIEW_MAX_ROUNDS > 0:
                await _sync_positions(project_id, built)
                await emit({"type": "state", "state": await state(project_id)})
                await review(project_id, owner, prompt, built, emit, settings.CAD_REVIEW_MAX_ROUNDS,
                             ground=True, plan_parts=parts, mate_problems=mate_problems)
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


VIEW_CAPTION = ("What the user sees in the 3D viewport as they ask for this change (CAD axes: Z up; the "
                "selected part is tinted blue, a selected face is highlighted orange, cyan arrows are its "
                "ports, and the red/green/blue arrows are the move gizmo, not geometry):")
PART_CAPTION = ("The part as it is now, rendered on its own: isometric, front (looking along +Y), right "
                "(looking along -X) and top views:")


async def edit(project_id: str, part_id: str, instruction: str, face: Optional[dict],
               view_image: Optional[bytes] = None, owner: Optional[str] = None) -> AsyncGenerator[dict, None]:
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
            images = [(view_image, VIEW_CAPTION)] if view_image else []
            logger.info("[cad] edit %s: viewport image %s", part_id,
                        f"{len(view_image) // 1024} KB" if view_image else "none")
            try:
                current_render = await agents.render_part(version["key"])
            except GeometryJobError:
                current_render = None
            if current_render:
                images.append((current_render, PART_CAPTION))
            code, key, meta = await develop(
                brief, prompts.edit_user(version["code"], instruction, version.get("meta"), face), retry, notify,
                assets=version.get("assets") or {}, images=images or None,
                required_ports=list((version.get("meta") or {}).get("ports") or {}),
            )
            params = {k: v for k, v in (version.get("params") or {}).items() if k in (meta.get("params") or {})}
            if params:
                key, meta = await build(code, params, version.get("assets") or {})
            new = await repo.add_version(part, code, params, version.get("assets") or {}, instruction, key, meta)
            await _say(emit, project_id, "assistant", f"Updated {part['name']} (v{new['number']}).",
                       {"kind": "edit", "part": part_id})
            await queue.put({"type": "part_done", "part_id": part_id, "part": part_view(part, new)})

            # The change can affect the rest of the assembly (ports moved, the part got bigger):
            # re-solve the mates and review everything, updating neighbours where needed.
            built = await _load_built(project_id)
            if len(built) > 1:
                mate_problems = await _place(project_id, owner, built)
                await _rest_on_ground(project_id, owner)
                await _sync_positions(project_id, built)
                await queue.put({"type": "state", "state": await state(project_id)})
                if settings.CAD_REVIEW_MAX_ROUNDS > 0:
                    await review(
                        project_id, owner,
                        f"The user changed {part['name']}: {instruction}. The rest of the assembly must still fit "
                        "and work with it; update other parts where they no longer do.",
                        built, emit, settings.CAD_REVIEW_MAX_ROUNDS, ground=True, plan_parts=[],
                        mate_problems=mate_problems)
                await queue.put({"type": "complete", "state": await state(project_id)})
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
