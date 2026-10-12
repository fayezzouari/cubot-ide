"""
Placing parts in the assembly from mates between ports.

A port is a named frame a part declares in its code with
`PORT(name, origin, axis, ref)`: `origin` is a point on the contact feature,
`axis` the outward normal of the contact face (pointing away from the part's
material, e.g. out of a shaft's tip, out of a hole's top face), and `ref` an
optional direction perpendicular to it that fixes the rotation about it.

A mate joins a port of the part being placed to a port of an already placed
part (or the ground, whose port faces +Z at the origin). The placed part is
turned so the two axes face each other, its `ref` lines up with the target's
`ref` (or it's turned by `angle` degrees about the axis), and moved so the
origins coincide, `gap` mm apart along the target's axis (negative pushes it
in, e.g. a wheel slid onto a shaft).

Older plans that attach by bounding-box faces still work (see `_attach`).

Rotations are stored as Euler XYZ degrees with R = Rx·Ry·Rz, the convention
of the runner and the viewer.
"""
import math
from typing import Optional

import numpy as np

GROUND_PORT = {"origin": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "ref": [1.0, 0.0, 0.0]}

SIDES = {"top", "bottom", "left", "right", "front", "back"}
# side → (normal axis, direction, the two in-face axes an offset runs along)
_FACES = {
    "top": (2, 1, (0, 1)), "bottom": (2, -1, (0, 1)),
    "right": (0, 1, (1, 2)), "left": (0, -1, (1, 2)),
    "back": (1, 1, (0, 2)), "front": (1, -1, (0, 2)),
}


# ── Rotation helpers ──────────────────────────────────────────────────────


def matrix(rot_deg) -> np.ndarray:
    rx, ry, rz = (math.radians(a) for a in rot_deg)
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    return np.array([
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ])


def euler(m: np.ndarray) -> list[float]:
    """Inverse of `matrix`: Euler XYZ degrees for R = Rx·Ry·Rz."""
    ry = math.asin(max(-1.0, min(1.0, m[0, 2])))
    if abs(m[0, 2]) < 0.999999:
        rx = math.atan2(-m[1, 2], m[2, 2])
        rz = math.atan2(-m[0, 1], m[0, 0])
    else:  # gimbal lock: fold everything into rx
        rx = math.atan2(m[2, 1], m[1, 1])
        rz = 0.0
    return [round(math.degrees(a), 4) + 0.0 for a in (rx, ry, rz)]


def _unit(v) -> np.ndarray:
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else np.array([0.0, 0.0, 1.0])


def _axis_angle(axis: np.ndarray, angle: float) -> np.ndarray:
    x, y, z = _unit(axis)
    c, s = math.cos(angle), math.sin(angle)
    t = 1 - c
    return np.array([
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ])


def _align(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Smallest rotation taking unit vector a onto unit vector b."""
    a, b = _unit(a), _unit(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c > 1 - 1e-9:
        return np.eye(3)
    if c < -1 + 1e-9:  # opposite: half turn about any perpendicular
        perp = np.cross(a, [1.0, 0.0, 0.0])
        if np.linalg.norm(perp) < 1e-6:
            perp = np.cross(a, [0.0, 1.0, 0.0])
        return _axis_angle(perp, math.pi)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def world_port(port: dict, position, rotation) -> dict:
    r = matrix(rotation)
    return {
        "origin": (r @ np.asarray(port["origin"], float)) + np.asarray(position, float),
        "axis": _unit(r @ np.asarray(port["axis"], float)),
        "ref": _unit(r @ np.asarray(port["ref"], float)) if port.get("ref") else None,
    }


def local_port(world: dict, position, rotation) -> dict:
    """A world-frame port expressed in the frame of a part placed at
    `position`/`rotation` (the inverse of `world_port`)."""
    r = matrix(rotation)
    origin = r.T @ (np.asarray(world["origin"], float) - np.asarray(position, float))
    axis = _unit(r.T @ np.asarray(world["axis"], float))
    ref = world.get("ref")
    return {
        "origin": [round(float(v), 3) + 0.0 for v in origin],
        "axis": [round(float(v), 4) + 0.0 for v in axis],
        "ref": [round(float(v), 4) + 0.0 for v in _unit(r.T @ np.asarray(ref, float))] if ref is not None else None,
    }


def _angle(a, b) -> float:
    c = float(np.dot(_unit(a), _unit(b)))
    return round(math.degrees(math.acos(max(-1.0, min(1.0, c)))), 2)


def mate_residual(own_world: dict, target_world: dict, gap: float) -> tuple[float, float]:
    """How far a mate is from closed: distance (mm) between the placed port's
    origin and where the target puts it (after the gap), and the angle
    (degrees) between the two axes and facing each other."""
    want = np.asarray(target_world["origin"], float) + gap * np.asarray(target_world["axis"], float)
    dist = float(np.linalg.norm(np.asarray(own_world["origin"], float) - want))
    return round(dist, 3), _angle(own_world["axis"], -np.asarray(target_world["axis"], float))


def port_deviation(declared: dict, required: dict) -> tuple[float, float]:
    """Distance (mm) and axis angle (degrees) between a port a part declares
    and the frame the plan requires for it, both in the part's frame."""
    dist = float(np.linalg.norm(np.asarray(declared["origin"], float) - np.asarray(required["origin"], float)))
    return round(dist, 3), _angle(declared["axis"], required["axis"])


def mate_frame(own: dict, target_world: dict, gap: float, angle_deg: float) -> tuple[list[float], list[float]]:
    """Position and rotation that put port `own` (in the part's frame) against
    the world-frame target port."""
    t_axis = target_world["axis"]
    r = _align(_unit(own["axis"]), -t_axis)
    if own.get("ref") and target_world.get("ref") is not None:
        current = r @ _unit(own["ref"])
        want = target_world["ref"] - np.dot(target_world["ref"], t_axis) * t_axis
        cur = current - np.dot(current, t_axis) * t_axis
        if np.linalg.norm(want) > 1e-6 and np.linalg.norm(cur) > 1e-6:
            want, cur = _unit(want), _unit(cur)
            twist = math.atan2(float(np.dot(np.cross(cur, want), t_axis)), float(np.dot(cur, want)))
            r = _axis_angle(t_axis, twist) @ r
    if angle_deg:
        r = _axis_angle(t_axis, math.radians(angle_deg)) @ r
    position = target_world["origin"] + gap * t_axis - r @ np.asarray(own["origin"], float)
    return [round(float(v), 4) for v in position], euler(r)


# ── Bounding-box fallback ─────────────────────────────────────────────────


def rotated_box(bbox: dict, rotation) -> tuple[list[float], list[float]]:
    r = matrix(rotation)
    corners = np.array([[x, y, z] for x in (bbox["min"][0], bbox["max"][0])
                        for y in (bbox["min"][1], bbox["max"][1]) for z in (bbox["min"][2], bbox["max"][2])]) @ r.T
    return corners.min(axis=0).tolist(), corners.max(axis=0).tolist()


def world_box(bbox: dict, position, rotation) -> tuple[list[float], list[float]]:
    lo, hi = rotated_box(bbox, rotation)
    return [lo[i] + position[i] for i in range(3)], [hi[i] + position[i] for i in range(3)]


def _attach(attach: dict, bbox: dict, rotation, target_box: Optional[tuple]) -> list[float]:
    rlo, rhi = rotated_box(bbox, rotation)
    if attach["to"] == "ground" or target_box is None:
        a, c = attach["offset"]
        return [a - (rlo[0] + rhi[0]) / 2, c - (rlo[1] + rhi[1]) / 2, -rlo[2] + attach["gap"]]
    tlo, thi = target_box
    axis, direction, (u, v) = _FACES[attach["side"]]
    pos = [0.0, 0.0, 0.0]
    pos[axis] = thi[axis] + attach["gap"] - rlo[axis] if direction > 0 else tlo[axis] - attach["gap"] - rhi[axis]
    for along, off in ((u, attach["offset"][0]), (v, attach["offset"][1])):
        pos[along] = (tlo[along] + thi[along]) / 2 + off - (rlo[along] + rhi[along]) / 2
    return pos


# ── Solver ────────────────────────────────────────────────────────────────


def solve(built: dict[str, dict]) -> tuple[dict[str, tuple[list[float], list[float]]], list[str]]:
    """Placements for every copy of every built part.

    `built[pid]` holds the part's plan ("spec", with one placement per copy),
    its build "meta" (bbox, ports) and its "instances". Targets are solved
    first; a copy whose mate can't be resolved keeps its planned placement
    and the problem is reported.
    Returns ({instance id: (position, rotation)}, problems)."""
    result: dict[str, tuple[list[float], list[float]]] = {}
    problems: list[str] = []

    def find(ref: str) -> Optional[tuple[str, int]]:
        pid, _, idx = ref.partition("#")
        group = built.get(pid)
        if not group:
            return None
        k = int(idx) - 1 if idx.isdigit() else 0
        return pid, min(max(k, 0), len(group["instances"]) - 1)

    def solve_one(pid: str, k: int, stack: tuple = ()) -> None:
        b = built[pid]
        inst = b["instances"][k]
        if inst["id"] in result:
            return
        placement = b["spec"]["placements"][k] if k < len(b["spec"]["placements"]) else {}
        position, rotation = list(inst["position"]), list(inst["rotation"])
        ports = b["meta"].get("ports") or {}
        mate = placement.get("mate")
        attach = placement.get("attach")
        name = f"{pid}#{k + 1}"

        if mate:
            own = ports.get(mate["port"])
            if own is None:
                problems.append(f"{name}: has no port '{mate['port']}' (it has {sorted(ports) or 'none'})")
            elif mate["to"] == "ground":
                position, rotation = mate_frame(own, world_port(GROUND_PORT, [0, 0, 0], [0, 0, 0]),
                                                mate["gap"], mate["angle"])
            else:
                target = find(mate["to"])
                if target is None:
                    problems.append(f"{name}: mates to unknown part '{mate['to']}'")
                elif built[target[0]]["instances"][target[1]]["id"] in stack + (inst["id"],):
                    problems.append(f"{name}: mates in a loop")
                else:
                    tpid, tk = target
                    solve_one(tpid, tk, stack + (inst["id"],))
                    tport = (built[tpid]["meta"].get("ports") or {}).get(mate["to_port"])
                    if tport is None:
                        problems.append(f"{name}: target {tpid}#{tk + 1} has no port '{mate['to_port']}' "
                                        f"(it has {sorted(built[tpid]['meta'].get('ports') or {}) or 'none'})")
                    else:
                        tpos, trot = result[built[tpid]["instances"][tk]["id"]]
                        position, rotation = mate_frame(own, world_port(tport, tpos, trot),
                                                        mate["gap"], mate["angle"])
        elif attach:
            target_box = None
            if attach["to"] != "ground":
                target = find(attach["to"])
                if target and built[target[0]]["instances"][target[1]]["id"] not in stack + (inst["id"],):
                    tpid, tk = target
                    solve_one(tpid, tk, stack + (inst["id"],))
                    tpos, trot = result[built[tpid]["instances"][tk]["id"]]
                    target_box = world_box(built[tpid]["meta"]["bbox"], tpos, trot)
            rotation = list(placement.get("rotation") or rotation)
            position = _attach(attach, b["meta"]["bbox"], rotation, target_box)
        result[inst["id"]] = ([round(v, 4) for v in position], rotation)

    for pid, b in built.items():
        for k in range(len(b["instances"])):
            solve_one(pid, k)
    return result, problems
