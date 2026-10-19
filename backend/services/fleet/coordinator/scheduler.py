from collections.abc import Callable
from math import hypot, inf
from typing import Any

Pos = tuple[float, float, float]
Eta = Callable[[Pos, Pos, float], float]


def _dist(a: Pos, b: Pos) -> float:
    return hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _deadline_key(t: dict[str, Any]) -> float:
    d = t.get("deadline_s")
    return d if d is not None else inf


def _eligible(robot_category: Any, task_categories: list[str]) -> bool:
    if not robot_category or not task_categories:
        return True
    return robot_category in task_categories


def schedule(
    robots: list[dict[str, Any]], tasks: list[dict[str, Any]], eta: Eta
) -> list[dict[str, Any]]:
    state = {
        r["id"]: {
            "cursor": r["position"],
            "t": 0.0,
            "speed": max(0.5, r.get("speed", 1.0)),
            "category": r.get("category_id"),
        }
        for r in robots
    }
    order = sorted(tasks, key=lambda t: (-int(t.get("priority", 1)), _deadline_key(t)))

    out: list[dict[str, Any]] = []
    for task in order:
        tid = task["id"]
        tpos: Pos = task["position"]
        dl = task.get("deadline_s")
        task_categories = task.get("category_ids") or []

        eligible = {
            rid: s
            for rid, s in state.items()
            if _eligible(s["category"], task_categories)
        }
        if not eligible:
            out.append({"task_id": tid, "robot_id": None, "eta_s": None, "due_in_s": dl, "reason": "unassigned"})
            continue

        comps = []
        for rid, s in eligible.items():
            comp = s["t"] + eta(s["cursor"], tpos, s["speed"])
            comps.append((rid, comp, _dist(s["cursor"], tpos)))

        nearest = min(comps, key=lambda c: c[2])[0]
        feasible = [c for c in comps if dl is None or c[1] <= dl]
        if feasible:
            rid, comp, _ = min(feasible, key=lambda c: c[1])
            reason = "assigned" if rid == nearest else "reassigned"
        else:
            rid, comp, _ = min(comps, key=lambda c: c[1])
            reason = "late"

        s = state[rid]
        s["cursor"] = tpos
        s["t"] = comp
        out.append({
            "task_id": tid,
            "robot_id": rid,
            "eta_s": round(comp, 2),
            "due_in_s": dl,
            "reason": reason,
        })

    return out
