"""
Part agents: one tool-using model per part, run in parallel (the swarm).

Each agent gets its part's brief from the plan (features, envelope, checks
and the shared interface values) and works in a loop: write code, build it
(`build_part` returns measured geometry or the error), look at a render
(`view_part`), fix, and `finish`. The best build so far is kept even if the
agent runs out of steps.
"""
import json
import logging
import os
from typing import Awaitable, Callable, Optional

from core.config import settings
from services.cad import assembly, llm, prompts, storage
from services.cad.geometry import GeometryJobError, geometry

logger = logging.getLogger(__name__)

Notify = Callable[[str, str], Awaitable[None]]  # (action, detail)
Build = Callable[[str], Awaitable[tuple[str, dict]]]  # code → (key, meta)

PORT_ORIGIN_TOL = 0.2  # mm a declared port may be from where the plan puts it
PORT_AXIS_TOL = 2.0  # degrees


class AgentFailed(Exception):
    pass


def required_list(required) -> list[dict]:
    """Required ports as dicts: {"name", "origin"?, "axis"?, "ref"?, "description"?}.
    Plain names (no frame) only require the port to exist."""
    out = []
    for p in required or []:
        if isinstance(p, str):
            out.append({"name": p})
        elif isinstance(p, dict) and p.get("name"):
            out.append(p)
    return out


def port_problems(meta: dict, required) -> list[str]:
    """Why a build can't be handed in: required ports that are missing or not
    where the plan puts them, and the runner's surface checks."""
    have = meta.get("ports") or {}
    out = []
    for p in required_list(required):
        got = have.get(p["name"])
        if got is None:
            where = f"; the plan puts it at origin {p['origin']}, axis {p['axis']}" if p.get("origin") else ""
            out.append(f"port {p['name']!r} is missing{where}")
            continue
        if p.get("origin") and p.get("axis"):
            dist, angle = assembly.port_deviation(got, p)
            if dist > PORT_ORIGIN_TOL or angle > PORT_AXIS_TOL:
                out.append(f"port {p['name']!r} is at origin {got['origin']}, axis {got['axis']}, but the plan "
                           f"needs origin {p['origin']}, axis {p['axis']} ({dist:.2f} mm, {angle:.1f}° off): "
                           "put the feature and its port where the plan says")
    out += [str(i) for i in (meta.get("port_issues") or [])]
    return out


ENVELOPE_TOL = 2.0  # mm a part may exceed its planned envelope, plus 5 %

Interference = Callable[[str, dict], Awaitable[list[str]]]  # (key, meta) → overlaps with the neighbours


def oversize(meta: dict, envelope: Optional[list]) -> Optional[str]:
    """Why the build is too big for its planned envelope, or None."""
    if not envelope or len(envelope) != 3:
        return None
    size = meta["bbox"]["size"]
    tol = ENVELOPE_TOL + 0.05 * max(envelope)
    over = [f"{'xyz'[i]} {size[i]:.1f} > {float(envelope[i]):.1f}" for i in range(3) if size[i] > float(envelope[i]) + tol]
    if not over:
        return None
    return (f"the part is {size[0]:.1f} × {size[1]:.1f} × {size[2]:.1f} mm but the plan allows "
            f"{envelope[0]} × {envelope[1]} × {envelope[2]} (+{tol:.0f}): {', '.join(over)}. "
            "Other parts are placed around that envelope; shrink it")


def _measurements(meta: dict, envelope: Optional[list], required_ports=None) -> str:
    report = {
        "bbox_min": meta["bbox"]["min"],
        "bbox_max": meta["bbox"]["max"],
        "size": meta["bbox"]["size"],
        "volume_mm3": meta.get("volume"),
        "valid_solid": meta.get("valid"),
        "solids": meta.get("solids"),
        "faces": meta.get("faces"),
        "parameters": {k: v["value"] for k, v in (meta.get("params") or {}).items()},
    }
    report["ports"] = meta.get("ports") or {}
    text = json.dumps(report)
    problems = port_problems(meta, required_ports)
    if problems:
        text += "\nPort problems (fix before finishing):\n" + "\n".join(f"- {i}" for i in problems)
    if envelope:
        text += f"\nExpected envelope: {envelope} mm."
        big = oversize(meta, envelope)
        if big:
            text += f"\nToo big (fix before finishing): {big}"
    if meta["bbox"]["min"][2] < -0.01 or abs(meta["bbox"]["min"][2]) > 0.5:
        text += f"\nNote: the part's lowest point is at z = {meta['bbox']['min'][2]}; it should rest on z = 0."
    return text


async def render_part(key: str) -> Optional[bytes]:
    mesh = storage.object_path(key, "mesh.json")
    if not mesh:
        return None
    out = storage.new_export_path("part.png")
    await geometry.run({"type": "render", "size": 300, "out_path": out,
                        "instances": [{"mesh_path": mesh, "color": [0.55, 0.62, 0.7]}]})
    with open(out, "rb") as f:
        data = f.read()
    try:
        os.remove(out)
    except OSError:
        pass
    return data


async def run_part_agent(brief: str, build: Build, notify: Notify, envelope: Optional[list] = None,
                         max_steps: Optional[int] = None,
                         required_ports: Optional[list] = None,
                         images: Optional[list[tuple[bytes, str]]] = None,
                         interference: Optional[Interference] = None) -> tuple[str, str, dict, str]:
    """Run one agent to completion. Returns (code, key, meta, notes).

    `required_ports` are names or {"name", "origin", "axis"} frames the build
    must declare (a frame within 0.2 mm and 2°); `images` are (bytes, caption)
    pairs shown with the brief, e.g. the user's viewport and a render of the
    part before the change."""
    steps = max_steps or settings.CAD_AGENT_STEPS
    first: object = brief
    if images:
        first = []
        for img, caption in images:
            first += [{"type": "text", "text": caption}, llm.png_block(img)]
        first.append({"type": "text", "text": brief})
    messages: list[dict] = [{"role": "user", "content": first}]
    best: Optional[tuple[str, str, dict]] = None
    overlaps: list[str] = []  # the best build's interference with its neighbours
    builds = 0
    viewed = False

    def blockers() -> list[str]:
        """What stops the best build from being handed in."""
        if not best:
            return []
        out = port_problems(best[2], required_ports)
        big = oversize(best[2], envelope)
        if big:
            out.append(big)
        return out + overlaps
    for step in range(steps):
        last = step == steps - 1
        if last and step > 0 and isinstance(messages[-1]["content"], list):
            messages[-1]["content"].append({"type": "text", "text": "Last step: call finish now."})
        response = await llm.agent_turn(prompts.AGENT_SYSTEM, messages, prompts.AGENT_TOOLS)
        content = response.get("content") or []
        messages.append({"role": "assistant", "content": content})
        calls = [c for c in content if c.get("type") == "tool_use"]
        if not calls:
            if best:
                return (*best, "")
            messages.append({"role": "user", "content": "Use the build_part tool to build the part."})
            continue
        results = []
        for call in calls:
            name, args = call["name"], call.get("input") or {}
            if name == "build_part":
                builds += 1
                await notify("build", f"build {builds}")
                code = str(args.get("code") or "")
                try:
                    key, meta = await build(code)
                except GeometryJobError as e:
                    error = str(e)
                    await notify("error", error.splitlines()[0][:200])
                    results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                    "content": f"Build failed:\n{error[-2500:]}"})
                    continue
                best = (code, key, meta)
                text = "Built.\n" + _measurements(meta, envelope, required_ports)
                overlaps = []
                if interference:
                    try:
                        overlaps = await interference(key, meta)
                    except GeometryJobError as e:
                        logger.warning("[cad] interference check failed: %s", e)
                    if overlaps:
                        await notify("error", f"overlaps {len(overlaps)} neighbour{'s' if len(overlaps) != 1 else ''}")
                        text += ("\nInterference with neighbours (placed as the plan places them; fix before "
                                 "finishing):\n" + "\n".join(f"- {o}" for o in overlaps))
                results.append({"type": "tool_result", "tool_use_id": call["id"], "content": text})
            elif name == "view_part":
                if not best:
                    results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                    "content": "Nothing built yet."})
                    continue
                await notify("view", "inspecting render")
                try:
                    image = await render_part(best[1])
                except GeometryJobError as e:
                    image = None
                    logger.warning("[cad] part render failed: %s", e)
                viewed = True
                results.append({"type": "tool_result", "tool_use_id": call["id"],
                                "content": [llm.png_block(image), {"type": "text", "text": "Render of your part."}]
                                if image else "Render unavailable."})
            elif name == "measure_part":
                if not best:
                    results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                    "content": "Nothing built yet."})
                    continue
                await notify("measure", "measuring features")
                step = storage.object_path(best[1], "part.step")
                try:
                    measured = await geometry.run({"type": "measure", "step_path": step}) if step else None
                except GeometryJobError as e:
                    measured = None
                    logger.warning("[cad] part measure failed: %s", e)
                results.append({"type": "tool_result", "tool_use_id": call["id"],
                                "content": json.dumps(measured) if measured else "Measurement unavailable."})
            elif name == "finish":
                problems = blockers()
                if problems and not last:
                    results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                    "content": "Can't finish yet:\n" + "\n".join(f"- {p}" for p in problems)
                                               + "\nFix the features, size and PORT declarations and build again."})
                    continue
                if best:
                    if not viewed and not last:
                        # One look before handing in catches most misplaced features.
                        viewed = True
                        results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                        "content": "Look at the render with view_part before finishing."})
                        continue
                    await notify("finish", str(args.get("notes") or "")[:200])
                    return (*best, str(args.get("notes") or ""))
                results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                "content": "No successful build yet."})
            else:
                results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                "content": f"Unknown tool {name}"})
        messages.append({"role": "user", "content": results})
    if best:
        return (*best, "")
    raise AgentFailed("The part agent couldn't produce a working build")
