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
import math
import os
import re
from datetime import timezone
from typing import AsyncGenerator, Awaitable, Callable, Optional

import numpy as np

from core.config import settings
from services.cad import agents, assembly, catalog, fasteners, llm, prompts, repository as repo, storage
from services.cad.geometry import GeometryJobError, geometry

assembly_mod = assembly  # for functions whose local `assembly` is the stored document

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
        "slug": part.get("slug"),  # the plan id mates refer to ("slug#copy")
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
                  assets: Optional[dict] = None, required_ports: Optional[list] = None,
                  images: Optional[list[tuple[bytes, str]]] = None,
                  interference: Optional[agents.Interference] = None) -> tuple[str, str, dict]:
    """Have a part agent design and verify a part; without a tool-capable
    model, fall back to one-shot writing with error feedback."""
    async def build_code(code: str) -> tuple[str, dict]:
        return await build(code, {}, assets or {})

    try:
        code, key, meta, _ = await agents.run_part_agent(brief, build_code, notify, envelope,
                                                         required_ports=required_ports, images=images,
                                                         interference=interference)
        return code, key, meta
    except llm.ToolsUnsupported:
        return await write_and_build(fallback_prompt, emit_retry, assets=assets)
    except agents.AgentFailed as e:
        raise StudioError(str(e))


# ── Generate from a prompt ────────────────────────────────────────────────


SIDES = assembly.SIDES
MAX_CUSTOM_PARTS = 30
MAX_BOUGHT_PARTS = 40  # catalog components plus fastener kinds


def _bought(spec: dict) -> bool:
    """Template parts (fasteners, catalog components) are placed, never redesigned."""
    return bool(spec.get("fastener") or spec.get("component"))


def _mate(raw) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    try:
        gap = float(raw.get("gap") or 0)
        angle = float(raw.get("angle") or 0)
    except (TypeError, ValueError):
        gap, angle = 0.0, 0.0
    return {"port": str(raw.get("port") or ""), "to": str(raw.get("to") or "ground"),
            "to_port": str(raw.get("to_port") or ""), "gap": gap, "angle": angle,
            "joint": "revolute" if str(raw.get("joint") or "").lower() == "revolute" else "fixed"}


def _port_spec(raw) -> Optional[dict]:
    """A planned port: name, description and, when the planner gave them, the
    frame (origin, unit axis, perpendicular ref) the part must declare."""
    if not isinstance(raw, dict) or not raw.get("name"):
        return None
    port = {"name": re.sub(r"[^A-Za-z0-9_]", "_", str(raw["name"]))[:40],
            "description": str(raw.get("description") or "")[:300]}
    if raw.get("meets"):
        port["meets"] = str(raw["meets"])[:80]
    tapped = raw.get("tapped")
    if isinstance(tapped, dict) and str(tapped.get("size") or "").upper() in fasteners.METRIC:
        try:
            port["tapped"] = {"size": str(tapped["size"]).upper(), "depth": float(tapped.get("depth") or 0) or None}
        except (TypeError, ValueError):
            pass
    if raw.get("joint") == "revolute":
        port["joint"] = "revolute"
    origin, axis = raw.get("origin"), raw.get("axis")
    if isinstance(origin, list) and len(origin) == 3 and isinstance(axis, list) and len(axis) == 3:
        a = _vec(axis)
        n = math.sqrt(sum(v * v for v in a))
        if n > 1e-9:
            port["origin"] = [round(v, 3) for v in _vec(origin)]
            port["axis"] = [round(v / n, 6) for v in a]
            ref = raw.get("ref")
            port["ref"] = None
            if isinstance(ref, list) and len(ref) == 3:
                r = _vec(ref)
                dot = sum(x * y for x, y in zip(r, port["axis"]))
                r = [x - dot * y for x, y in zip(r, port["axis"])]
                rn = math.sqrt(sum(v * v for v in r))
                if rn > 1e-9:
                    port["ref"] = [round(v / rn, 6) for v in r]
    return port


def _ports_from_meta(meta: dict, described: Optional[list[dict]] = None) -> list[dict]:
    """Port specs taken from a build: the frames the part has now."""
    notes = {p["name"]: p.get("description") or "" for p in (described or []) if p.get("name")}
    return [{"name": n, "description": notes.get(n, ""), "origin": v["origin"], "axis": v["axis"],
             "ref": v.get("ref")} for n, v in (meta.get("ports") or {}).items()]


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
            mate = _mate(c.get("mate"))
            also = [m for m in (_mate(x) for x in (c.get("also") or []) if isinstance(c.get("also"), list))
                    if m and m["port"]][:12]
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
                "also": also,
                "attach": None if mate else attach,
            })
        color = raw.get("color")
        envelope = raw.get("envelope")
        fastener = fasteners.normalise(raw["fastener"]) if isinstance(raw.get("fastener"), dict) else None
        component = catalog.normalise(raw) if raw.get("component") else None
        name = str(raw.get("name") or pid.replace("_", " ").title())[:120]
        description = str(raw.get("description") or raw.get("name") or "")
        if fastener:
            ports = [{"name": n, "description": "", **f} for n, f in fasteners.ports(fastener).items()]
            color = color or fasteners.COLORS[fastener["kind"]]
            envelope = fasteners.envelope(fastener)
        elif component:
            ports = [{"name": n, "description": "", **f} for n, f in catalog.ports(component).items()]
            color = color or catalog.color(component)
            name = catalog.name(component)
            description = catalog.COMPONENTS[component["id"]]["about"]
            envelope = catalog.envelope(component)
        else:
            ports = [p for p in (_port_spec(p) for p in (raw.get("ports") or [])) if p][:40]
        parts.append({
            "fastener": fastener,
            "component": component,
            "ports": ports,
            "id": pid,
            "name": name,
            "description": description,
            "manufacturing": str(raw.get("manufacturing") or "")[:300],
            "role": str(raw.get("role") or "")[:300],
            "envelope": _vec(envelope) if isinstance(envelope, list) else None,
            "features": [str(f)[:400] for f in (raw.get("features") or []) if f][:20],
            "checks": [str(c)[:300] for c in (raw.get("checks") or []) if c][:12],
            "interfaces": [str(i) for i in (raw.get("interfaces") or [])][:20],
            "placements": placements or [{"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0],
                                          "mate": None, "also": [], "attach": None}],
            "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
            else PALETTE[i % len(PALETTE)],
        })
    custom = [p for p in parts if not _bought(p)][:MAX_CUSTOM_PARTS]
    bought = [p for p in parts if _bought(p)][:MAX_BOUGHT_PARTS]
    keep = {id(p) for p in custom + bought}
    return [p for p in parts if id(p) in keep]


def _tag_joints(parts: list[dict], built: dict[str, dict]) -> None:
    """A mate onto a rotary port (servo shaft, motor shaft, bearing bore) is a
    revolute joint whether or not the architect said so."""
    rotary: dict[str, set] = {}
    for pid, b in built.items():
        rotary[pid] = {p["name"] for p in b["spec"].get("ports") or [] if p.get("joint") == "revolute"}
    for spec in parts:
        rotary[spec["id"]] = {p["name"] for p in spec["ports"] if p.get("joint") == "revolute"}
    for spec in parts:
        for pl in spec["placements"]:
            m = pl.get("mate")
            if m and m["to"] != "ground" and m["to_port"] in rotary.get(m["to"].partition("#")[0], set()):
                m["joint"] = "revolute"


def _architecture_to_plan(arch: dict) -> dict:
    """The architect's answer as the flat plan `_expand_plan` reads: bought
    parts first (components, hardware), then the custom parts."""
    raw = []
    for c in arch.get("components") or []:
        if isinstance(c, dict):
            raw.append({**c, "component": c.get("component")})
    for h in arch.get("hardware") or []:
        if isinstance(h, dict):
            raw.append(h)
    for p in arch.get("parts") or []:
        if isinstance(p, dict):
            raw.append(p)
    return {k: arch.get(k) for k in ("name", "summary", "style", "interfaces", "screws", "update", "remove",
                                     "placements")} | {"parts": raw}


def _split_ref(ref: str) -> tuple[str, int, str]:
    """"part#2.port" → (part, copy index, port)."""
    head, _, port = str(ref or "").rpartition(".")
    pid, _, idx = head.partition("#")
    return pid, (int(idx) - 1 if idx.isdigit() else 0), port


def _derive_screws(screws: list, built: dict[str, dict]) -> tuple[list[dict], list[str]]:
    """The deterministic part of the assembler: screw kinds and copies from
    the architect's joints ("head sits here, threads into there / nut there")
    and the placed geometry. The clamped stack is measured along the shank
    between the two ports, the thread engagement or nut is added, and the
    stock length chosen. Returns (raw fastener parts for `_expand_plan`,
    problems)."""
    problems: list[str] = []
    kinds: dict[tuple, dict] = {}
    nuts: dict[str, dict] = {}

    def resolve(ref) -> tuple[Optional[tuple], Optional[str]]:
        pid, k, port = _split_ref(ref)
        b = built.get(pid)
        if not b or not 0 <= k < len(b["instances"]):
            return None, f"unknown part or copy {ref!r}"
        frame = (b["meta"].get("ports") or {}).get(port)
        if not frame:
            return None, f"{pid} has no port {port!r} (it has {sorted(b['meta'].get('ports') or {})})"
        inst = b["instances"][k]
        spec_port = next((p for p in b["spec"].get("ports") or [] if p["name"] == port), {})
        return (assembly.world_port(frame, inst["position"], inst["rotation"]), spec_port, f"{pid}#{k + 1}", port), None

    for s in screws or []:
        if not isinstance(s, dict):
            continue
        size = str(s.get("size") or "").upper().replace(" ", "")
        label = f"screw {size} on {s.get('head_on')}"
        if size not in fasteners.METRIC:
            problems.append(f"{label}: unknown size")
            continue
        head, err = resolve(s.get("head_on"))
        if err:
            problems.append(f"{label}: {err}")
            continue
        hw, _, hlabel, hport = head
        shank = -hw["axis"]
        if s.get("into"):
            target, err = resolve(s["into"])
            if err:
                problems.append(f"{label}: {err}")
                continue
            tw, tspec, _, _ = target
            depth = float(np.dot(tw["origin"] - hw["origin"], shank))
            if depth < -0.01:
                problems.append(f"{label}: {s['into']} is on the head's side of the face, not under it")
                continue
            if not tspec.get("tapped"):
                problems.append(f"{label}: {s['into']} is not a tapped port; use nut_on or a tapped port")
                continue
            needed = depth + fasteners.engagement(size, (tspec.get("tapped") or {}).get("depth"))
        elif s.get("nut_on"):
            target, err = resolve(s["nut_on"])
            if err:
                problems.append(f"{label}: {err}")
                continue
            tw, _, tlabel, tport = target
            depth = float(np.dot(tw["origin"] - hw["origin"], shank))
            if depth < -0.01:
                problems.append(f"{label}: {s['nut_on']} is on the head's side of the face, not under it")
                continue
            needed = depth + fasteners.nut_height(size) + 1.0
            nut = nuts.setdefault(size, {"id": f"{size.lower().replace('.', '_')}_nut",
                                         "fastener": {"kind": "nut", "size": size}, "copies": []})
            nut["copies"].append({"mate": {"port": "seat", "to": tlabel, "to_port": tport}})
        else:
            problems.append(f"{label}: needs 'into' (a tapped port) or 'nut_on'")
            continue
        length = fasteners.screw_length(needed)
        kind = kinds.setdefault((size, length), {
            "id": f"{size.lower().replace('.', '_')}x{length:g}_screw",
            "fastener": {"kind": "screw", "size": size, "length": length}, "copies": []})
        kind["copies"].append({"mate": {"port": "seat", "to": hlabel, "to_port": hport}})
    return list(kinds.values()) + list(nuts.values()), problems


async def _plan(prompt: str, built: dict[str, dict], view_image: Optional[bytes],
                emit: Emit) -> tuple[dict, list[dict], list[dict], list[str]]:
    """Two-stage planning. Stage 1 (architect, with thinking): parts, catalog
    components, hardware, mates, screws, interfaces and style. Stage 2 (one
    call per custom part, in parallel): features, exact port frames and
    checks. Then the plan is checked against its own numbers and the parts
    named in the problems are detailed once more with the residuals.
    Returns (plan, new parts, updates, remaining problems)."""
    existing = [_describe_existing(slug, b) for slug, b in built.items()]
    show = [view_image] if view_image and existing else None
    arch = await llm.structured(
        prompts.ARCHITECT_SYSTEM,
        prompts.architect_user(prompt, existing[:40]) + (
            "\n\nThe attached image is the user's current 3D viewport (Z up)." if show else ""),
        "submit_architecture", prompts.ARCHITECTURE_SCHEMA, max_tokens=16000, think=settings.CAD_PLAN_THINK,
        images=show)
    plan = _architecture_to_plan(arch)
    interfaces = {str(k): (v if isinstance(v, dict) else {"value": v}) for k, v in (plan.get("interfaces") or {}).items()}
    for b in built.values():
        for k, v in (b.get("interfaces") or {}).items():
            interfaces.setdefault(k, v)
    custom = [p for p in plan["parts"] if isinstance(p, dict) and not p.get("component") and not p.get("fastener")]
    await emit({"type": "agent", "plan_id": "__plan", "action": "detail",
                "detail": f"detailing {len(custom)} parts"})

    def known_frames() -> dict[str, dict[str, dict]]:
        """Port frames already fixed: catalog parts, hardware, existing parts."""
        frames: dict[str, dict[str, dict]] = {pid: dict(b["meta"].get("ports") or {}) for pid, b in built.items()}
        for p in plan["parts"]:
            if p.get("component") and catalog.normalise(p):
                frames[str(p.get("id"))] = catalog.ports(catalog.normalise(p))
            elif isinstance(p.get("fastener"), dict) and fasteners.normalise(p["fastener"]):
                frames[str(p.get("id"))] = fasteners.ports(fasteners.normalise(p["fastener"]))
        return frames

    def partners(part: dict, frames: dict) -> dict[str, dict]:
        out = {}
        for port in part.get("ports") or []:
            if not isinstance(port, dict) or not port.get("meets"):
                continue
            pid, _, pname = _split_ref(port["meets"])
            f = (frames.get(pid) or {}).get(pname)
            if f:
                out[port["meets"]] = {"origin": f["origin"], "axis": f["axis"]}
        return out

    async def detail(part: dict, problems: Optional[list[str]] = None) -> None:
        frames = known_frames()
        try:
            d = await llm.structured(
                prompts.DETAIL_SYSTEM,
                prompts.detail_user(arch, part, interfaces, partners(part, frames), problems, part.get("_detail")),
                "submit_part", prompts.PART_DETAIL_SCHEMA, max_tokens=6000, fast=True)
        except Exception as e:
            logger.warning("[cad] detailing %s failed: %s", part.get("id"), e)
            return
        part["_detail"] = d
        named = {p["name"]: p for p in part.get("ports") or [] if isinstance(p, dict) and p.get("name")}
        ports = []
        for p in d.get("ports") or []:
            if not isinstance(p, dict) or not p.get("name"):
                continue
            base = named.get(p["name"], {})
            ports.append({**base, **p, "tapped": p.get("tapped") or base.get("tapped")})
        for name, base in named.items():  # a port the detailer dropped keeps its name (no frame: flagged)
            if name not in {p["name"] for p in ports}:
                ports.append(base)
        part["ports"] = ports
        part["features"] = d.get("features") or []
        part["checks"] = d.get("checks") or []
        if isinstance(d.get("envelope"), list) and len(d["envelope"]) == 3:
            part["envelope"] = d["envelope"]

    await asyncio.gather(*(detail(p) for p in custom))
    for u in plan.get("update") or []:  # changed parts with moved ports get frames the same way
        if isinstance(u, dict) and u.get("ports") and u.get("part") in built:
            b = built[u["part"]]
            stub = {"id": u["part"], "name": b["spec"]["name"], "role": b["spec"].get("role"),
                    "description": (b["spec"].get("description") or "") + "\nChange: " + str(u.get("instruction") or ""),
                    "envelope": (b["meta"].get("bbox") or {}).get("size"), "ports": u["ports"], "copies": []}
            await detail(stub)
            u["ports"] = stub["ports"]

    parts = [p for p in _expand_plan(plan) if p["id"] not in built]
    updates = _updates(plan, built)
    problems = _validate_plan(parts, built, updates) if (parts or updates) else []
    if problems:
        logger.info("[cad] plan check: %s", problems)
        await emit({"type": "agent", "plan_id": "__plan", "action": "check",
                    "detail": f"{len(problems)} plan problems; re-detailing"})
        named = {pid for p in problems for pid in re.findall(r"\b([a-z0-9_]+)(?:#\d+)?(?::|\.| )", p)}
        redo = [p for p in custom if str(p.get("id")) in named or
                any(str(p.get("id")) + "." in q or str(p.get("id")) + "#" in q or q.startswith(str(p.get("id")) + ":")
                    for q in problems)]
        if redo:
            await asyncio.gather(*(detail(p, problems) for p in redo))
            parts2 = [p for p in _expand_plan(plan) if p["id"] not in built]
            problems2 = _validate_plan(parts2, built, updates) if (parts2 or updates) else []
            if len(problems2) <= len(problems):
                parts, problems = parts2, problems2
    _tag_joints(parts, built)
    return plan, parts, updates, problems


PLAN_CLOSE_MM = 0.5  # an "also" contact may be this far off with the plan's numbers
PLAN_CLOSE_DEG = 2.0


def _planned_frames(spec: dict) -> dict[str, dict]:
    return {p["name"]: p for p in spec.get("ports") or [] if p.get("origin") and p.get("axis")}


def _validate_plan(parts: list[dict], built: dict[str, dict], updates: Optional[list[dict]] = None) -> list[str]:
    """Check a plan against its own numbers before any part is built: every
    mate names ports that exist, every custom port has a frame, and every
    "also" contact closes when the parts are placed by the plan's frames."""
    names: dict[str, set] = {pid: set(b["meta"].get("ports") or {}) for pid, b in built.items()}
    frames: dict[str, dict] = {pid: dict(b["meta"].get("ports") or {}) for pid, b in built.items()}
    for u in updates or []:
        for p in u.get("ports") or []:
            if p.get("name") and u["part"] in names:
                names[u["part"]].add(p["name"])
                if p.get("origin"):
                    frames[u["part"]][p["name"]] = p
    problems: list[str] = []
    for spec in parts:
        names[spec["id"]] = {p["name"] for p in spec["ports"]}
        frames[spec["id"]] = _planned_frames(spec)
        for p in spec["ports"]:
            if not spec["fastener"] and p["name"] not in frames[spec["id"]]:
                problems.append(f"{spec['id']}: port {p['name']!r} has no origin/axis")
    joined = bool(built) or len(parts) > 1
    for spec in parts:
        for k, pl in enumerate(spec["placements"]):
            label = f"{spec['id']}#{k + 1}"
            if joined and not pl["mate"] and not pl["attach"]:
                problems.append(f"{label}: has no mate; every copy is joined to a part or to the ground")
            for m in ([pl["mate"]] if pl["mate"] else []) + pl["also"]:
                if m["port"] not in names[spec["id"]]:
                    problems.append(f"{label}: mates with its port {m['port']!r}, which it doesn't declare "
                                    f"(it has {sorted(names[spec['id']])})")
                if m["to"] == "ground":
                    continue
                tid = m["to"].partition("#")[0]
                if tid not in names:
                    problems.append(f"{label}: mates to unknown part {m['to']!r}")
                elif m["to_port"] not in names[tid]:
                    problems.append(f"{label}: target {tid} has no port {m['to_port']!r} "
                                    f"(it has {sorted(names[tid])})")
    if problems:
        return problems
    # Place everything by the plan's frames and see whether the "also" contacts close.
    fake, placed, solve_problems = _paper(parts, built)
    problems += [p for p in solve_problems if "loop" in p]
    for spec in parts:
        for k, pl in enumerate(spec["placements"]):
            inst = fake[spec["id"]]["instances"][k]
            for m in pl["also"]:
                own = frames[spec["id"]].get(m["port"])
                tid, _, idx = m["to"].partition("#")
                tk = min(max(int(idx) - 1 if idx.isdigit() else 0, 0), len(fake[tid]["instances"]) - 1)
                tinst = fake[tid]["instances"][tk]
                tport = frames[tid].get(m["to_port"])
                if not own or not tport or inst["id"] not in placed or tinst["id"] not in placed:
                    continue
                dist, angle = assembly.mate_residual(
                    assembly.world_port(own, *placed[inst["id"]]),
                    assembly.world_port(tport, *placed[tinst["id"]]), m["gap"])
                if dist > PLAN_CLOSE_MM or angle > PLAN_CLOSE_DEG:
                    problems.append(
                        f"{spec['id']}#{k + 1}: the contact {m['port']} → {m['to']}.{m['to_port']} doesn't close: "
                        f"placed by the plan's port numbers the two ports are {dist} mm apart and the axes "
                        f"{angle}° from facing each other; fix the port origins, axes or interface values")
    problems += _paper_overlaps(fake, placed, {spec["id"] for spec in parts})
    return problems


def _paper(parts: list[dict], built: dict[str, dict]) -> tuple[dict[str, dict], dict, list[str]]:
    """The assembly on paper: built parts as they are, planned parts as their
    envelope box with the planned port frames, all placed by the solver.
    Returns (working set, {instance id: (position, rotation)}, problems).
    Planned copies get the ids "plan:<part>#<n>"."""
    fake: dict[str, dict] = dict(built)
    for spec in parts:
        env = spec.get("envelope") or [10.0, 10.0, 10.0]
        fake[spec["id"]] = {
            "spec": spec,
            "meta": {"ports": _planned_frames(spec),
                     "bbox": {"min": [-env[0] / 2, -env[1] / 2, 0.0], "max": [env[0] / 2, env[1] / 2, env[2]]}},
            "instances": [{"id": f"plan:{spec['id']}#{k + 1}", "position": pl["position"], "rotation": pl["rotation"]}
                          for k, pl in enumerate(spec["placements"])],
        }
    placed, problems = assembly.solve(fake)
    for b in fake.values():  # unplaced copies keep their stored placement
        for inst in b["instances"]:
            placed.setdefault(inst["id"], (list(inst["position"]), list(inst["rotation"])))
    return fake, placed, problems


def _adjacent(fake: dict[str, dict]) -> set[tuple[str, str]]:
    """Pairs of copies joined by a mate or an "also" contact (either way),
    as ("part#n", "part#n") with n from 1."""
    pairs: set[tuple[str, str]] = set()
    for pid, b in fake.items():
        for k, pl in enumerate(b["spec"].get("placements") or []):
            for m in ([pl.get("mate")] if pl.get("mate") else []) + list(pl.get("also") or []):
                if m["to"] == "ground":
                    continue
                tpid, _, idx = m["to"].partition("#")
                t = f"{tpid}#{int(idx) if idx.isdigit() else 1}"
                pairs.add((f"{pid}#{k + 1}", t))
                pairs.add((t, f"{pid}#{k + 1}"))
    return pairs


def _paper_overlaps(fake: dict[str, dict], placed: dict, planned: set) -> list[str]:
    """Planned envelopes that sit inside each other on paper. Only pairs that
    aren't mated to each other count (a bracket's envelope legitimately
    wraps the servo it holds), and only when most of the smaller box is
    inside the other."""
    boxes = []
    for pid, b in fake.items():
        if b["spec"].get("fastener"):
            continue
        for k, inst in enumerate(b["instances"]):
            pos, rot = placed.get(inst["id"], (inst["position"], inst["rotation"]))
            lo, hi = assembly.world_box(b["meta"]["bbox"], pos, rot)
            boxes.append((f"{pid}#{k + 1}", pid, lo, hi))
    adjacent = _adjacent(fake)
    problems = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            la, pa, alo, ahi = boxes[i]
            lb, pb, blo, bhi = boxes[j]
            if pa not in planned and pb not in planned or (la, lb) in adjacent:
                continue
            shared = 1.0
            for ax in range(3):
                shared *= max(0.0, min(ahi[ax], bhi[ax]) - max(alo[ax], blo[ax]))
            va = (ahi[0] - alo[0]) * (ahi[1] - alo[1]) * (ahi[2] - alo[2])
            vb = (bhi[0] - blo[0]) * (bhi[1] - blo[1]) * (bhi[2] - blo[2])
            smaller = max(min(va, vb), 1e-6)
            if shared > 50 and shared / smaller > 0.5:
                problems.append(f"{la} and {lb} overlap on paper: placed by the plan their envelopes share "
                                f"{shared:.0f} mm³ ({shared / smaller * 100:.0f}% of the smaller one) and they aren't "
                                "mated to each other; fix the envelopes, port frames or mates")
    return problems


def _local_box(lo, hi, position, rotation) -> tuple[list[float], list[float]]:
    """A world box as an axis-aligned box in the frame of a part placed at position/rotation."""
    r = assembly.matrix(rotation)
    p = np.asarray(position, float)
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
    local = (corners - p) @ r  # r.T applied to each row
    return [round(float(v), 1) for v in local.min(axis=0)], [round(float(v), 1) for v in local.max(axis=0)]


def _neighbourhood(pid: str, k: int, fake: dict[str, dict], placed: dict,
                   built: dict[str, dict]) -> tuple[list[str], list[dict], dict[str, dict], tuple]:
    """What surrounds copy k of part `pid` once the assembly is put together:
    keep-out lines in the part's own frame, the neighbours as instances for
    the exact check (built parts by their solid, planned ones by their
    envelope box), a label per instance id, and the copy's own placement."""
    own_inst = fake[pid]["instances"][k]
    own = placed.get(own_inst["id"], (own_inst["position"], own_inst["rotation"]))
    olo, ohi = assembly.world_box(fake[pid]["meta"]["bbox"], *own)
    centre = np.array([(olo[i] + ohi[i]) / 2 for i in range(3)])
    reach = float(np.linalg.norm(np.array(ohi) - np.array(olo))) / 2 + 20.0
    contacts: dict[str, list[str]] = {}
    pl = fake[pid]["spec"]["placements"][k] if k < len(fake[pid]["spec"]["placements"]) else {}
    for m in ([pl.get("mate")] if pl.get("mate") else []) + list(pl.get("also") or []):
        if m["to"] != "ground":
            tpid, _, idx = m["to"].partition("#")
            contacts.setdefault(f"{tpid}#{int(idx) if idx.isdigit() else 1}", []).append(f"{m['port']} → {m['to_port']}")
    adjacent = _adjacent(fake)
    lines, jobs, labels = [], [], {}
    for qid, b in fake.items():
        for j, inst in enumerate(b["instances"]):
            if qid == pid and j == k:
                continue
            pos, rot = placed.get(inst["id"], (inst["position"], inst["rotation"]))
            exact = qid in built and built[qid].get("version")
            meta = built[qid]["meta"] if exact else b["meta"]
            lo, hi = assembly.world_box(meta["bbox"], pos, rot)
            qc = np.array([(lo[i] + hi[i]) / 2 for i in range(3)])
            qr = float(np.linalg.norm(np.array(hi) - np.array(lo))) / 2
            if np.linalg.norm(qc - centre) > reach + qr:
                continue
            label = f"{qid}#{j + 1}"
            llo, lhi = _local_box(lo, hi, *own)
            touch = contacts.get(label)
            lines.append(f"{label} ({b['spec']['name']}): x {llo[0]}..{lhi[0]}, y {llo[1]}..{lhi[1]}, "
                         f"z {llo[2]}..{lhi[2]}" + (f"; you meet it at {', '.join(touch)}" if touch else ""))
            labels[inst["id"]] = (label, b["spec"]["name"], bool(exact))
            if exact:
                step = storage.object_path(built[qid]["version"]["key"], "part.step")
                if step:
                    jobs.append({"id": inst["id"], "step_path": step, "position": pos, "rotation": rot})
            elif (f"{pid}#{k + 1}", label) not in adjacent:
                # An unbuilt neighbour's envelope: only when it isn't meant to touch this part.
                jobs.append({"id": inst["id"], "box": [meta["bbox"]["min"], meta["bbox"]["max"]],
                             "position": pos, "rotation": rot})
    return lines[:14], jobs, labels, own


def _interference(pid: str, k: int, fake: dict[str, dict], placed: dict,
                  built: dict[str, dict]) -> agents.Interference:
    """The part agent's interference check: its fresh build, placed as the
    plan places it, intersected exactly with the neighbours (those built by
    now by their solid). Overlaps come back in the part's own frame."""
    async def check(key: str, meta: dict) -> list[str]:
        _, jobs, labels, own = _neighbourhood(pid, k, fake, placed, built)
        step = storage.object_path(key, "part.step")
        if not step or not jobs:
            return []
        result = await geometry.run({"type": "check", "pairs": [], "near": 0.5,
                                     "instances": [{"id": "self", "step_path": step, "position": own[0],
                                                    "rotation": own[1]}] + jobs})
        out = []
        for p in result["pairs"]:
            if "self" not in (p["a"], p["b"]) or p["overlap"] <= COLLISION_MM3 or not p.get("box"):
                continue
            other = p["b"] if p["a"] == "self" else p["a"]
            label, name, exact = labels[other]
            c = assembly.local_port({"origin": p["centre"], "axis": [0, 0, 1]}, *own)["origin"]
            lo, hi = _local_box(p["box"][0], p["box"][1], *own)
            out.append(f"overlaps {label} ({name}{'' if exact else ', planned envelope'}) by {p['overlap']:.0f} mm³: "
                       f"in your frame around ({c[0]}, {c[1]}, {c[2]}), within x {lo[0]}..{hi[0]}, "
                       f"y {lo[1]}..{hi[1]}, z {lo[2]}..{hi[2]}; remove your material there")
        return out
    return check


def _live_placed(built: dict[str, dict]) -> dict:
    return {inst["id"]: (list(inst["position"]), list(inst["rotation"]))
            for b in built.values() for inst in b["instances"]}


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
            intent[inst["id"]] = (pl.get("mate"), pl.get("attach"), pl.get("also") or [])
    stored = await repo.get_assembly(project_id)
    instances = stored.get("instances", [])
    for inst in instances:
        if inst["id"] in placements:
            inst["position"], inst["rotation"] = placements[inst["id"]]
        if inst["id"] in intent:
            inst["mate"], inst["attach"], inst["also"] = intent[inst["id"]]
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
    style = await repo.get_style(project_id)
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
        spec.setdefault("component", None)
        if not any(p.get("origin") for p in spec.get("ports") or []):
            # No planned frames (older part): the frames it has are the plan.
            spec["ports"] = _ports_from_meta(meta, spec.get("ports") or [])
        spec.update({"id": slug, "name": part["name"], "color": part["color"],
                     "placements": [{"position": i["position"], "rotation": i["rotation"],
                                     "mate": i.get("mate"), "also": i.get("also") or [], "attach": i.get("attach")}
                                    for i in copies]})
        built[slug] = {"spec": spec, "meta": meta, "instances": copies, "part": part, "version": version,
                       "interfaces": interfaces, "overall": overall or assembly_doc.get("name", ""), "style": style}
    return built


def _brief(b: dict) -> str:
    """The brief a part's agent gets for a redesign: its (current) spec, the
    shared interface values, the style and the assembly's name."""
    return prompts.agent_brief(b["spec"], b.get("interfaces") or {}, b.get("overall") or "", [], b.get("style"))


async def _adopt_ports(part: dict, meta: dict) -> dict:
    """After a change made outside the plan (the user's edit, parameters,
    code, a revert) the build is the truth: the part's planned port frames
    follow it, and neighbours are brought to it by the review."""
    spec = dict(part.get("spec") or {})
    spec["ports"] = _ports_from_meta(meta, spec.get("ports") or [])
    await repo.update_part(part["_id"], {"spec": spec})
    part["spec"] = spec
    return spec


def _describe_existing(slug: str, b: dict) -> dict:
    """What the planner needs to know about a part already in the assembly."""
    meta = b["meta"]
    return {
        "id": slug,
        "name": b["spec"]["name"],
        "role": b["spec"].get("role") or "",
        "description": (b["spec"].get("description") or "")[:300],
        "fastener": b["spec"].get("fastener"),
        "component": b["spec"].get("component"),
        "size": (meta.get("bbox") or {}).get("size"),
        "params": {k: v["value"] for k, v in (meta.get("params") or {}).items()},
        "ports": {n: {"origin": v["origin"], "axis": v["axis"]} for n, v in (meta.get("ports") or {}).items()},
        "copies": [{"mate": i.get("mate"), "position": i["position"]} for i in b["instances"]],
    }


def _spec_to_store(spec: dict) -> dict:
    keys = ("role", "description", "features", "checks", "interfaces", "ports", "envelope", "fastener",
            "component", "manufacturing")
    return {k: spec.get(k) for k in keys}


def _updates(plan: dict, built: dict[str, dict]) -> list[dict]:
    """The planner's changes to existing parts, with their port lists
    normalised to frames (or None when the planner gave none)."""
    out = []
    for u in plan.get("update") or []:
        if isinstance(u, dict) and u.get("part") in built:
            u = dict(u)
            u["ports"] = ([p for p in (_port_spec(p) for p in u["ports"]) if p]
                          if isinstance(u.get("ports"), list) else None)
            out.append(u)
    return out[:8]


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


async def _check(built: dict[str, dict], mate_problems: list[str]) -> tuple[str, list[str], dict]:
    """Exact checks on the placed solids (geometry worker): every pair's
    shared volume and distance. Returns (world-box listing, problems,
    details): collisions (with where), mates and "also" contacts whose parts
    don't touch, parts touching nothing, plus mates that couldn't be
    resolved. `details` holds the measured collisions and open contacts for
    the automatic repair."""
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
            contacts = [("mate", placement.get("mate"))] + [("also", m) for m in placement.get("also") or []]
            for kind, mate in contacts:
                if mate and mate["to"] != "ground":
                    tpid, _, idx = mate["to"].partition("#")
                    if tpid in built:
                        group = built[tpid]["instances"]
                        tk = min(max(int(idx) - 1 if idx.isdigit() else 0, 0), len(group) - 1)
                        mates.append((inst["id"], group[tk]["id"], mate, kind))
    problems = list(mate_problems)
    details: dict = {"collisions": [], "apart": []}
    if len(jobs) < 2:
        return "\n".join(lines), problems, details
    result = await geometry.run({"type": "check", "instances": jobs,
                                 "pairs": [[a, b] for a, b, _, _ in mates], "near": 1.0})
    by_pair = {tuple(sorted((p["a"], p["b"]))): p for p in result["pairs"]}
    for p in result["pairs"]:
        if p["overlap"] > COLLISION_MM3:
            where = f" around {p['centre']}" if p.get("centre") else ""
            problems.append(f"{labels[p['a']]} and {labels[p['b']]} collide: {p['overlap']:.1f} mm³ of shared "
                            f"volume{where}")
            details["collisions"].append(p)
    for a, b, mate, kind in mates:
        p = by_pair.get(tuple(sorted((a, b))))
        if p and p["distance"] > CONTACT_MM + max(mate["gap"], 0):
            if kind == "mate":
                problems.append(f"{labels[a]} is mated to {labels[b]} ({mate['port']} → {mate['to_port']}) but "
                                f"they're {p['distance']:.1f} mm apart: a port isn't on the part's surface")
            else:
                problems.append(f"{labels[a]} should also touch {labels[b]} ({mate['port']} → {mate['to_port']}) "
                                f"but they're {p['distance']:.1f} mm apart")
            details["apart"].append({"a": a, "b": b, "mate": mate, "kind": kind, "distance": p["distance"]})
    lowest = min(result["lowest"].values())
    for iid, label in labels.items():
        touching = any(p["distance"] >= 0 and p["distance"] <= CONTACT_MM and iid in (p["a"], p["b"])
                       for p in result["pairs"])
        if not touching and result["lowest"].get(iid, lowest) - lowest > CONTACT_MM:
            problems.append(f"{label} touches nothing: it floats")
    grounded = [labels[i] for i, z in result["lowest"].items() if z - lowest <= CONTACT_MM]
    lines.append(f"Parts touching the ground (z = {lowest:.1f}): {', '.join(grounded)}")
    # With a copy mated to the ground, z = 0 is the floor: nothing may hang below it.
    if any((pl.get("mate") or {}).get("to") == "ground"
           for b in built.values() for pl in b["spec"]["placements"]):
        for iid, z in result["lowest"].items():
            if z < -CONTACT_MM:
                problems.append(f"{labels[iid]} reaches {-z:.1f} mm below the ground (z = 0): it is mated on the "
                                "wrong side or points the wrong way")
    return "\n".join(lines), problems, details


def _diagnose(built: dict[str, dict], details: dict) -> list[dict]:
    """Fixes that follow from the measurements alone, as instructions for the
    part agents (no reviewer involved): ports off their planned frame or off
    the surface, "also" contacts that don't close (the planned port is moved
    onto the other part's port), and screws through solid material (a
    clearance hole where the shank is). Returns [{"part", "instruction"}]."""
    lines: dict[str, list[str]] = {}
    where = {inst["id"]: (pid, k) for pid, b in built.items() for k, inst in enumerate(b["instances"])}

    def add(pid: str, text: str) -> None:
        lines.setdefault(pid, []).append(text)

    def label(iid: str) -> str:
        pid, k = where[iid]
        return f"{pid}#{k + 1}"

    for pid, b in built.items():
        if _bought(b["spec"]):
            continue
        for text in agents.port_problems(b["meta"], b["spec"].get("ports") or []):
            add(pid, text)

    for item in details["apart"]:
        if item["kind"] != "also":
            continue
        (pid, k), (tpid, tk) = where[item["a"]], where[item["b"]]
        if pid in lines or tpid in lines:
            continue  # port fixes come first; they may close it
        m = item["mate"]
        # The custom part's port moves onto the other port (a bought part's can't move).
        if _bought(built[pid]["spec"]):
            if _bought(built[tpid]["spec"]):
                continue
            mover, mk, mport, other, ok, oport = tpid, tk, m["to_port"], pid, k, m["port"]
        else:
            mover, mk, mport, other, ok, oport = pid, k, m["port"], tpid, tk, m["to_port"]
        o_port = (built[other]["meta"].get("ports") or {}).get(oport)
        if not o_port:
            continue
        o_inst, m_inst = built[other]["instances"][ok], built[mover]["instances"][mk]
        ow = assembly.world_port(o_port, o_inst["position"], o_inst["rotation"])
        want = assembly.local_port({"origin": ow["origin"] + m["gap"] * ow["axis"], "axis": -ow["axis"]},
                                   m_inst["position"], m_inst["rotation"])
        ports = built[mover]["spec"].setdefault("ports", [])
        entry = next((p for p in ports if p["name"] == mport), None)
        if entry is None:
            entry = {"name": mport, "description": ""}
            ports.append(entry)
        entry["origin"], entry["axis"] = want["origin"], want["axis"]
        now = (built[mover]["meta"].get("ports") or {}).get(mport)
        add(mover, f"port {mport!r} must be at origin {want['origin']}, axis {want['axis']} (that is where "
                   f"{label(o_inst['id'])}'s port {oport!r} meets it); it is "
                   f"{'at ' + str(now['origin']) if now else 'missing'}. Move the feature there.")

    def excess(pid: str) -> float:
        """How far a part exceeds its planned envelope (mm, largest axis)."""
        env = built[pid]["spec"].get("envelope")
        size = built[pid]["meta"]["bbox"]["size"]
        return max((size[i] - float(env[i]) for i in range(3)), default=0.0) if env and len(env) == 3 else 0.0

    for p in details["collisions"]:
        (pa, ka), (pb, kb) = where[p["a"]], where[p["b"]]
        sa, sb = built[pa]["spec"], built[pb]["spec"]
        fa, fb = sa.get("fastener"), sb.get("fastener")
        if not p.get("centre"):
            continue
        # A screw through a custom part: it needs a clearance hole where the shank is.
        if bool(fa) != bool(fb) and (fa or fb)["kind"] == "screw" and not _bought(sb if fa else sa):
            screw = fa or fb
            s_iid, p_iid = (p["a"], p["b"]) if fa else (p["b"], p["a"])
            (spid, sk), (ppid, pk) = where[s_iid], where[p_iid]
            s_inst, p_inst = built[spid]["instances"][sk], built[ppid]["instances"][pk]
            shank = assembly.world_port({"origin": [0, 0, 0], "axis": [0, 0, 1]}, s_inst["position"], s_inst["rotation"])
            local = assembly.local_port({"origin": p["centre"], "axis": shank["axis"]},
                                        p_inst["position"], p_inst["rotation"])
            hole = fasteners.METRIC[screw["size"]][6]
            add(ppid, f"the {fasteners.name(screw)} ({label(s_iid)}) passes through your material: {p['overlap']:.1f} mm³ "
                      f"of it is inside you around {local['origin']} (your coordinates), along the axis {local['axis']}. "
                      f"Give it a {hole} mm through clearance hole on that axis there (or move the existing hole onto "
                      "it), with the hole's ports on both faces.")
            continue
        if _bought(sa) and _bought(sb) or not p.get("box"):
            continue  # two bought parts: a template or placement matter for the reviewer
        # Otherwise the custom part gives way; between two custom parts, the one further over
        # its envelope, else the child in the mate tree.
        if _bought(sa):
            culprit, other = (pb, kb), (pa, ka)
        elif _bought(sb):
            culprit, other = (pa, ka), (pb, kb)
        else:
            ea, eb = excess(pa), excess(pb)
            if abs(ea - eb) > 0.5:
                culprit, other = ((pa, ka), (pb, kb)) if ea > eb else ((pb, kb), (pa, ka))
            else:
                mate = (built[pa]["spec"]["placements"][ka].get("mate") or {}) if ka < len(built[pa]["spec"]["placements"]) else {}
                a_is_child = str(mate.get("to", "")).partition("#")[0] == pb
                culprit, other = ((pa, ka), (pb, kb)) if a_is_child else ((pb, kb), (pa, ka))
        cpid, ck = culprit
        inst = built[cpid]["instances"][ck]
        c = assembly.local_port({"origin": p["centre"], "axis": [0, 0, 1]}, inst["position"], inst["rotation"])["origin"]
        lo, hi = _local_box(p["box"][0], p["box"][1], inst["position"], inst["rotation"])
        oname = built[other[0]]["spec"]["name"]
        add(cpid, f"you overlap {other[0]}#{other[1] + 1} ({oname}) by {p['overlap']:.0f} mm³: in your frame around "
                  f"({c[0]}, {c[1]}, {c[2]}), within x {lo[0]}..{hi[0]}, y {lo[1]}..{hi[1]}, z {lo[2]}..{hi[2]}. "
                  "Remove your material there (a pocket, a cutout, a shorter wall), keeping your ports where they are.")
    return [{"part": pid, "instruction": "\n".join(f"- {t}" for t in texts)} for pid, texts in lines.items()]


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
    """Reflection loop, checks first.

    1. Automatic repair (no reviewer, `CAD_REPAIR_ROUNDS` at most): the exact
       checks and the planned port frames decide what's wrong, and the part
       agents get numeric instructions: ports off the plan or off the
       surface, contacts that don't close, screws through solid material.
    2. Reviewer rounds: render the assembly, check it exactly, let the
       reviewer judge it against the request and apply its fixes (part
       redesigns first, then re-mates), then review again. They end when the
       reviewer is satisfied and the exact checks pass, when it has no fix
       left, when two rounds in a row change nothing, or after `max_rounds`.
    """
    history: list[dict] = []  # what earlier rounds found and did, so fixes aren't undone
    fixed_total: list[str] = []
    idle_rounds = 0
    snapshotted = False
    outcome, remaining = "limit", []
    missing = [p["name"] for p in plan_parts if p["id"] not in built]
    mate_problems = list(mate_problems or [])
    round_no = 0

    async def snapshot() -> None:
        nonlocal snapshotted
        if not snapshotted:
            await repo.create_snapshot(project_id, "Before review fixes", auto=True)
            snapshotted = True

    async def redesign(pid: str, instruction: str, ports: Optional[list[dict]] = None,
                       enforce: bool = True) -> Optional[str]:
        """Have a part's agent apply an instruction. `ports` replaces the
        planned frames. With `enforce` the build must match the planned
        frames; without it the instruction may legitimately move features,
        so the frames follow the build instead."""
        b = built[pid]
        await emit({"type": "part_started", "plan_id": pid})

        async def retry(attempt: int, error: str):
            await emit({"type": "part_retry", "plan_id": pid, "attempt": attempt, "error": error})

        async def notify(action: str, detail: str):
            await emit({"type": "agent", "plan_id": pid, "action": action, "detail": detail})

        if ports:
            known = {p["name"]: p for p in b["spec"].get("ports") or []}
            b["spec"]["ports"] = [{**known.get(p["name"], {}), **p} for p in ports]
        try:
            if _bought(b["spec"]):
                raise StudioError("bought parts and fasteners are not redesigned; re-place them or change the plan")
            try:
                before_render = await agents.render_part(b["version"]["key"])
            except GeometryJobError:
                before_render = None
            required = (b["spec"].get("ports") or []) if enforce else [p["name"] for p in b["spec"].get("ports") or []]
            placed_now = _live_placed(built)
            b["spec"]["keep_out"] = _neighbourhood(pid, 0, built, placed_now, built)[0]
            code, key, meta = await develop(
                _brief(b) + "\n\n" + prompts.agent_revise(b["version"]["code"], instruction, None),
                prompts.edit_user(b["version"]["code"], instruction, b["meta"], None),
                retry, notify, b["spec"].get("envelope"), required_ports=required,
                images=[(before_render, PART_CAPTION)] if before_render else None,
                interference=_interference(pid, 0, built, placed_now, built))
        except Exception as err:
            await emit({"type": "part_failed", "plan_id": pid, "error": str(err)[:500]})
            return None
        b["version"] = await repo.add_version(b["part"], code, {}, {}, f"Review: {instruction[:200]}", key, meta)
        b["meta"] = meta
        if not enforce:
            b["spec"]["ports"] = _ports_from_meta(meta, b["spec"].get("ports") or [])
        await repo.update_part(b["part"]["_id"], {"spec": _spec_to_store(b["spec"])})
        await emit({"type": "part_done", "plan_id": pid, "part": part_view(b["part"], b["version"])})
        return f"edited {pid}: {instruction[:200]}"

    async def settle() -> None:
        """Re-solve the mates after fixes and show the result."""
        nonlocal mate_problems
        mate_problems = await _place(project_id, owner, built)
        if ground:
            await _rest_on_ground(project_id, owner)
        await _sync_positions(project_id, built)
        await emit({"type": "state", "state": await state(project_id)})

    # ── 1. Automatic repair from the measurements ─────────────────────────
    for _ in range(settings.CAD_REPAIR_ROUNDS):
        try:
            _, _, details = await _check(built, mate_problems)
        except GeometryJobError as e:
            logger.warning("[cad] exact check failed: %s", e)
            break
        fixes = _diagnose(built, details)
        if not fixes:
            break
        round_no += 1
        await emit({"type": "reviewing", "round": round_no})
        await snapshot()
        results = await asyncio.gather(*(redesign(f["part"], f["instruction"]) for f in fixes))
        applied = [r for r in results if r]
        rejected = [f"auto-fix {f['part']}: failed to build" for f, r in zip(fixes, results) if not r]
        await settle()
        issues = [f"{f['part']}: {line[2:]}" for f in fixes for line in f["instruction"].splitlines()]
        history.append({"round": round_no, "issues": issues, "applied": applied, "rejected": rejected})
        if applied:
            fixed_total += issues
        await emit({"type": "review", "round": round_no, "ok": False, "issues": issues, "fixed": len(applied),
                    "note": f"Auto-fix from measurements: {len(applied)} part{'s' if len(applied) != 1 else ''} "
                            "corrected"})
        if not applied:
            break

    # ── 2. Reviewer rounds ────────────────────────────────────────────────
    for _ in range(max_rounds):
        round_no += 1
        await emit({"type": "reviewing", "round": round_no})
        images = await review_images(project_id, emit, round_no)
        try:
            facts, problems, _ = await _check(built, mate_problems)
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
                "copies": [{"mate": pl.get("mate"), "also": pl.get("also") or None, "attach": pl.get("attach"),
                            "rotation": inst["rotation"]}
                           for inst, pl in zip(b["instances"], b["spec"]["placements"])],
            })
        try:
            # A forced tool call: the verdict is valid JSON by construction.
            verdict = await llm.structured(
                prompts.REVIEW_SYSTEM,
                prompts.review_user(request, parts, facts, problems, bool(images), history),
                "submit_review", prompts.REVIEW_SCHEMA, max_tokens=6000, images=images or None)
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

        await snapshot()
        applied: list[str] = []
        rejected: list[str] = []

        # Redesign parts first (in parallel, with their agents): a re-mate may need a port an edit adds.
        if edits:
            results = await asyncio.gather(*(
                redesign(e["part"], str(e.get("instruction") or ""),
                         ports=[p for p in (_port_spec(p) for p in (e.get("ports") or [])) if p] or None,
                         enforce=bool(e.get("ports")))
                for e in edits))
            applied += [r for r in results if r]
            rejected += [f"edit {e['part']} ({str(e.get('instruction') or '')[:120]}): failed to build"
                         for e, r in zip(edits, results) if not r]
            mate_problems = await _place(project_id, owner, built)

        # Re-mate copies, but keep the moves only if the exact checks don't get worse.
        if moves:
            try:
                _, before, _ = await _check(built, mate_problems)
            except GeometryJobError:
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
                fixed["also"] = b["spec"]["placements"][k].get("also") or []
                b["spec"]["placements"][k] = fixed
                if fixed.get("attach"):
                    b["instances"][k]["rotation"] = fixed["rotation"]
                how = fixed.get("mate") or fixed.get("attach") or {}
                described.append(f"re-placed {m['part']}#{k + 1}: {json.dumps(how)}")
            if described:
                trial, trial_problems = assembly.solve(built)
                _apply(built, trial)
                try:
                    _, after, _ = await _check(built, trial_problems)
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

        await settle()
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
               "limit": f"it reached the limit of {max_rounds} reviewer rounds"}[outcome]
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
            existing = bool(built)
            # Two-stage plan (architecture, then per-part detail), checked against its own numbers.
            # A plan that can't be made is an error, never a silently simplified build.
            try:
                plan, parts, updates, plan_problems = await _plan(prompt, built, view_image, emit)
            except llm.QuotaExceeded as e:
                raise StudioError(str(e))
            except llm.Truncated as e:
                raise StudioError(f"The architect's answer was too long ({e}); ask for a smaller design or split it")
            except StudioError:
                raise
            except Exception as e:
                logger.exception("[cad] planning failed")
                raise StudioError(f"Planning failed: {str(e)[:300]}")
            removals = [r for r in (plan.get("remove") or []) if r in built]
            remates = [m for m in (plan.get("placements") or []) if isinstance(m, dict) and m.get("part") in built]
            if not parts and not updates and not removals and not remates:
                raise StudioError("The architect found nothing to change; try describing the change more precisely"
                                  if existing else "The architect produced no parts; try describing the object")
            overall = plan.get("name") or (await repo.get_assembly(project_id)).get("name") or prompt
            if plan.get("name"):
                await repo.name_assembly_if_unnamed(project_id, owner, str(plan["name"]))
            new_interfaces = {
                str(k): v if isinstance(v, dict) else {"value": v}
                for k, v in (plan.get("interfaces") or {}).items()
            } if isinstance(plan.get("interfaces"), dict) else {}
            await repo.merge_interfaces(project_id, new_interfaces)
            interfaces = await repo.get_interfaces(project_id)
            if isinstance(plan.get("style"), dict) and plan["style"]:
                await repo.set_style(project_id, plan["style"])
            style = await repo.get_style(project_id)
            for b in built.values():
                b["style"] = style
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

            # The assembly on paper: where every copy will be, so each agent can see its neighbours.
            paper, paper_placed, _ = _paper(parts, built)
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
                    # With a port list the planner fixed the new frames and the build must meet them;
                    # without one the instruction may move features, so the frames follow the build.
                    planned = bool(u.get("ports"))
                    if planned:
                        known = {p["name"]: p for p in spec.get("ports") or []}
                        spec["ports"] = [{**known.get(p["name"], {}), **p} for p in u["ports"]]
                    required = spec.get("ports") if planned else [p["name"] for p in spec.get("ports") or []]
                    try:
                        if _bought(spec):
                            raise StudioError("bought parts and fasteners are replaced, not redesigned")
                        try:
                            before = await agents.render_part(b["version"]["key"])
                        except GeometryJobError:
                            before = None
                        images = ([(view_image, VIEW_CAPTION)] if view_image else []) + (
                            [(before, PART_CAPTION)] if before else [])
                        spec["keep_out"] = _neighbourhood(slug, 0, paper, paper_placed, built)[0]
                        brief = (prompts.agent_brief(spec, interfaces, overall, [], style)
                                 + "\n\n" + prompts.agent_revise(b["version"]["code"], instruction, None))
                        code, key, meta = await develop(
                            brief, prompts.edit_user(b["version"]["code"], instruction, b["meta"], None),
                            retry, notify, spec.get("envelope"), images=images or None, required_ports=required,
                            interference=_interference(slug, 0, paper, paper_placed, built))
                    except Exception as e:
                        await emit({"type": "part_failed", "plan_id": slug, "error": str(e)[:2000]})
                        return
                    b["version"] = await repo.add_version(b["part"], code, b["version"].get("params") or {}, {},
                                                          instruction, key, meta)
                    b["meta"] = meta
                    if not planned:
                        spec["ports"] = _ports_from_meta(meta, spec.get("ports") or [])
                    b["interfaces"], b["overall"], b["style"] = interfaces, overall, style
                    await repo.update_part(b["part"]["_id"], {"spec": _spec_to_store(spec)})
                    updated.append(slug)
                    await emit({"type": "part_done", "plan_id": slug, "part": part_view(b["part"], b["version"])})

            # Build new parts (agents, or templates for fasteners and catalog components).
            async def make(spec: dict):
                async with gate:
                    await emit({"type": "part_started", "plan_id": spec["id"]})
                    retry, notify = hooks(spec["id"])
                    siblings = [{"name": o["name"], "description": o["description"]} for o in parts
                                if o is not spec and not _bought(o)] + [
                        {"name": b["spec"]["name"], "description": b["spec"]["description"]}
                        for b in built.values() if not _bought(b["spec"])]
                    try:
                        if spec["fastener"] or spec["component"]:
                            # Bought: fixed template with exact ports, no agent needed.
                            code = fasteners.code(spec["fastener"]) if spec["fastener"] else catalog.code(spec["component"])
                            key, meta = await build(code, {}, {}, check_ports=False)
                        else:
                            # The agent knows its neighbours (in its own frame) and every build is
                            # placed among them and checked for interference.
                            spec["keep_out"] = _neighbourhood(spec["id"], 0, paper, paper_placed, built)[0]
                            code, key, meta = await develop(
                                prompts.agent_brief(spec, interfaces, overall, siblings, style),
                                prompts.part_user(spec["name"],
                                                  spec["description"] + "\n" + "\n".join(spec["features"]), overall),
                                retry, notify, spec.get("envelope"), required_ports=spec["ports"],
                                interference=_interference(spec["id"], 0, paper, paper_placed, built))
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
                         "mate": pl.get("mate"), "also": pl.get("also") or [], "attach": pl.get("attach")}
                        for k, pl in enumerate(spec["placements"])
                    ]
                    await repo.add_instances(project_id, owner, instances)
                    built[spec["id"]] = {"spec": spec, "meta": meta, "instances": instances,
                                         "part": part, "version": version,
                                         "interfaces": interfaces, "overall": overall, "style": style}
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
                    placement = _expand_plan({"parts": [{"id": m["part"], "copies": [m]}]})[0]["placements"][0]
                    if not placement["also"]:
                        placement["also"] = b["spec"]["placements"][k].get("also") or []
                    b["spec"]["placements"][k] = placement

            mate_problems = await _place(project_id, owner, built) if built else []

            # The deterministic assembler: screws (and their nuts) are derived from the
            # architect's joints and the placed geometry, then placed like any other part.
            screw_specs, screw_problems = _derive_screws(plan.get("screws") or [], built)
            derived = [s for s in _expand_plan({"parts": screw_specs}) if s["id"] not in built]
            if derived:
                await emit({"type": "plan", "name": overall, "summary": None, "interfaces": {},
                            "parts": [{"id": s["id"], "name": s["name"], "description": "derived from the joints",
                                       "features": [], "count": len(s["placements"])} for s in derived],
                            "append": True})
                await asyncio.gather(*(make(s) for s in derived))
                parts = parts + derived
                mate_problems = await _place(project_id, owner, built)
            plan_problems = plan_problems + screw_problems
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
            if plan_problems:
                summary += "\nThe plan didn't pass its own checks; the review has to sort out:\n" + "\n".join(
                    f"• {p}" for p in plan_problems[:6])
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


# ── Collision shapes for the physics sandbox ──────────────────────────────


async def ensure_hulls(key: str) -> Optional[str]:
    """Path of the part's convex pieces (hulls.json), made on first request
    by the geometry worker from the preview mesh. None if the part has no
    mesh or the worker can't decompose."""
    done = storage.object_path(key, "hulls.json")
    if done:
        return done
    mesh = storage.object_path(key, "mesh.json")
    if not mesh:
        return None
    out = os.path.join(storage.object_dir(key), "hulls.json")
    try:
        await geometry.run({"type": "decompose", "mesh_path": mesh, "out_path": out})
    except GeometryJobError as e:
        logger.warning("[cad] decomposition of %s failed: %s", key, e)
        return None
    return storage.object_path(key, "hulls.json")


# ── Edit an existing part ─────────────────────────────────────────────────


async def _current(project_id: str, part_id: str) -> tuple[dict, dict]:
    part = await repo.get_part(project_id, part_id)
    if not part:
        raise StudioError("Part not found")
    version = await repo.get_version(part_id, part["current_version"]) if part.get("current_version") else None
    if not version:
        raise StudioError("Part has no version")
    return part, version


# ── Preview captures (screenshots of the user's own viewer, for the review) ──

# The browser renders these with the same materials and lighting the user sees.
REVIEW_VIEWS = [
    {"name": "iso_front_right", "dir": [1, -1, 0.8], "caption": "Isometric from the front-right, above"},
    {"name": "iso_back_left", "dir": [-1, 1, 0.8], "caption": "Isometric from the back-left, above"},
    {"name": "front", "dir": [0, -1, 0.05], "caption": "Front (camera on -Y looking along +Y)"},
    {"name": "right", "dir": [1, 0, 0.05], "caption": "Right side (camera on +X looking along -X)"},
    {"name": "top", "dir": [0, 0, 1], "caption": "Top (looking down, +Y up in the image)"},
    {"name": "under", "dir": [1, -1, -0.9], "caption": "From below, front-right (shows parts under plates)"},
]
CAPTURE_TIMEOUT = 25.0  # s to wait for the browser before falling back to the server render
_captures: dict[str, tuple[str, asyncio.Future]] = {}  # request id → (project id, future)


def deliver_capture(project_id: str, request_id: str, images: list[dict]) -> bool:
    """Called by the route when the browser posts the screenshots it took."""
    entry = _captures.get(request_id)
    if not entry or entry[0] != project_id or entry[1].done():
        return False
    entry[1].set_result(images)
    return True


async def review_images(project_id: str, emit: Emit, round_no: int) -> list[tuple[bytes, str]]:
    """Screenshots of the assembly from many angles, taken by the user's open
    viewer; if no browser answers in time, the geometry worker's render."""
    request_id = repo.new_id()
    future: asyncio.Future = asyncio.get_running_loop().create_future()
    _captures[request_id] = (project_id, future)
    try:
        await emit({"type": "capture", "request_id": request_id, "round": round_no,
                    "views": [{"name": v["name"], "dir": v["dir"]} for v in REVIEW_VIEWS]})
        try:
            shots = await asyncio.wait_for(future, CAPTURE_TIMEOUT)
        except asyncio.TimeoutError:
            shots = []
    finally:
        _captures.pop(request_id, None)
    captions = {v["name"]: v["caption"] for v in REVIEW_VIEWS}
    images = []
    for shot in shots:
        img = llm.decode_view_image(shot.get("data"))
        if img and shot.get("view") in captions:
            images.append((img, f"Preview, {captions[shot['view']]}:"))
    logger.info("[cad] review round %d: %d preview screenshots from the browser", round_no, len(images))
    if images:
        return images
    try:
        rendered = await render_assembly(project_id)
    except GeometryJobError as e:
        logger.warning("[cad] review render failed: %s", e)
        return []
    return [(rendered, "Render: top-left isometric (front-right, above), top-right front (looking along +Y), "
                       "bottom-left right side (looking along -X), bottom-right top view (+Y up):")] if rendered else []


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
            await _adopt_ports(part, meta)  # the user's change is the new truth; neighbours follow
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
    await _adopt_ports(part, meta)
    return part_view(part, new)


async def set_code(project_id: str, part_id: str, code: str) -> dict:
    part, version = await _current(project_id, part_id)
    try:
        key, meta = await build(code, {}, version.get("assets") or {})
    except GeometryJobError as e:
        raise StudioError(str(e))
    new = await repo.add_version(part, code, {}, version.get("assets") or {}, "Code edited by hand", key, meta)
    await _adopt_ports(part, meta)
    return part_view(part, new)


async def revert(project_id: str, part_id: str, version_id: str) -> dict:
    part = await repo.get_part(project_id, part_id)
    old = await repo.get_version(part_id, version_id) if part else None
    if not old:
        raise StudioError("Version not found")
    await repo.update_part(part_id, {"current_version": version_id})
    part["current_version"] = version_id
    await _adopt_ports(part, old.get("meta") or {})
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
    # The mate tree, for the URDF export: which copy each copy hangs off, and the joint axis.
    by_slug: dict[str, list[dict]] = {}
    for inst in assembly.get("instances", []):
        slug = (parts.get(inst["part_id"]) or {}).get("slug")
        if slug:
            by_slug.setdefault(slug, []).append(inst)
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
        parent, axis, joint = None, None, "fixed"
        mate = inst.get("mate")
        if mate and mate.get("to") != "ground":
            tpid, _, idx = str(mate["to"]).partition("#")
            group = by_slug.get(tpid) or []
            if group:
                target = group[min(max(int(idx) - 1 if idx.isdigit() else 0, 0), len(group) - 1)]
                tversion = versions_by_id.get(parts[target["part_id"]]["current_version"]) if target["part_id"] in parts else None
                tport = ((tversion or {}).get("meta") or {}).get("ports", {}).get(mate.get("to_port"))
                parent = target["id"]
                joint = mate.get("joint") or "fixed"
                if tport:
                    axis = [float(v) for v in assembly_mod.world_port(tport, target["position"], target["rotation"])["axis"]]
        jobs.append({
            "id": inst["id"],
            "name": inst["name"],
            "step_path": step,
            "position": inst["position"],
            "rotation": inst["rotation"],
            "color": _hex_to_rgb(inst.get("color") or part["color"]),
            "parent": parent,
            "joint": joint,
            "axis": axis,
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
