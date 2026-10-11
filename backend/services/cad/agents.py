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
from services.cad import llm, prompts, storage
from services.cad.geometry import GeometryJobError, geometry

logger = logging.getLogger(__name__)

Notify = Callable[[str, str], Awaitable[None]]  # (action, detail)
Build = Callable[[str], Awaitable[tuple[str, dict]]]  # code → (key, meta)


class AgentFailed(Exception):
    pass


def _measurements(meta: dict, envelope: Optional[list], required_ports: Optional[list[str]] = None) -> str:
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
    lacking = [p for p in (required_ports or []) if p not in report["ports"]]
    if lacking:
        text += f"\nMissing required ports: {lacking}."
    if meta.get("port_issues"):
        text += "\nPort problems (fix before finishing):\n" + "\n".join(f"- {i}" for i in meta["port_issues"])
    if envelope:
        text += f"\nExpected envelope: {envelope} mm."
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
                         required_ports: Optional[list[str]] = None) -> tuple[str, str, dict, str]:
    """Run one agent to completion. Returns (code, key, meta, notes)."""
    steps = max_steps or settings.CAD_AGENT_STEPS
    messages: list[dict] = [{"role": "user", "content": brief}]
    best: Optional[tuple[str, str, dict]] = None
    builds = 0
    viewed = False
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
                results.append({"type": "tool_result", "tool_use_id": call["id"],
                                "content": "Built.\n" + _measurements(meta, envelope, required_ports)})
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
            elif name == "finish":
                lacking = [p for p in (required_ports or []) if best and p not in (best[2].get("ports") or {})]
                bad = (best[2].get("port_issues") or []) if best else []
                if best and (lacking or bad) and not last:
                    problems = ([f"missing ports {lacking}"] if lacking else []) + bad
                    results.append({"type": "tool_result", "tool_use_id": call["id"], "is_error": True,
                                    "content": "Can't finish yet:\n" + "\n".join(f"- {p}" for p in problems)
                                               + "\nFix the PORT declarations and build again."})
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
