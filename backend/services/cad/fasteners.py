"""
Standard fasteners, built from fixed templates instead of by a part agent.

Sizes follow ISO 4762 (socket head cap screws), ISO 4032 (hex nuts),
ISO 7089 (washers) and common female-female hex standoffs. Threads are not
modelled: a screw's shank has the nominal diameter, so it passes through a
clearance hole without touching it, and nuts and standoffs are bored to the
nominal diameter, so a screw threads into them without the interference
check seeing a collision.

Ports (axis = outward normal of the contact face):
  screw     "seat"  underside of the head, axis along the shank (towards the tip)
            "tip"   end of the shank, axis along the shank
  nut       "seat"  bottom face, axis -Z;  "top" top face, axis +Z
  washer    "seat"  bottom face, axis -Z;  "top" top face, axis +Z
  standoff  "bottom" bottom face, axis -Z; "top" top face, axis +Z
"""
from typing import Optional

# size: (head diameter, head height, nut across flats, nut height, washer OD, washer thickness, clearance hole)
METRIC = {
    "M1.6": (3.0, 1.6, 3.2, 1.3, 4.0, 0.3, 1.8),
    "M2": (3.8, 2.0, 4.0, 1.6, 5.0, 0.3, 2.4),
    "M2.5": (4.5, 2.5, 5.0, 2.0, 6.0, 0.5, 2.9),
    "M3": (5.5, 3.0, 5.5, 2.4, 7.0, 0.5, 3.4),
    "M4": (7.0, 4.0, 7.0, 3.2, 9.0, 0.8, 4.5),
    "M5": (8.5, 5.0, 8.0, 4.7, 10.0, 1.0, 5.5),
    "M6": (10.0, 6.0, 10.0, 5.2, 12.0, 1.6, 6.6),
}
KINDS = {"screw", "nut", "washer", "standoff"}
COLORS = {"screw": "#9aa0a6", "nut": "#8a9096", "washer": "#b0b5ba", "standoff": "#c9a24a"}
LENGTHS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]  # ISO 4762 stock lengths


def clearance_table() -> str:
    return ", ".join(f"{size}: {v[6]} mm" for size, v in METRIC.items())


def clearance(size: str) -> float:
    return METRIC[size][6]


def nut_height(size: str) -> float:
    return METRIC[size][3]


def screw_length(needed: float) -> float:
    """The shortest stock length at least `needed` mm (the clamped stack plus
    the nut or the thread engagement)."""
    return float(next((n for n in LENGTHS if n >= needed - 1e-6), LENGTHS[-1]))


def engagement(size: str, depth: Optional[float] = None) -> float:
    """Thread engagement a screw needs in a tapped part: about 1.5 d, or the
    tapped depth when that is shallower."""
    d = float(size[1:])
    want = round(1.5 * d, 1)
    return min(want, depth) if depth else want


def normalise(raw: dict) -> Optional[dict]:
    """{"kind": "screw", "size": "M3", "length": 10} → checked spec, or None."""
    kind = str(raw.get("kind") or raw.get("type") or "").lower().replace("socket_", "").replace("bolt", "screw")
    size = str(raw.get("size") or "").upper().replace(" ", "")
    if kind not in KINDS or size not in METRIC:
        return None
    try:
        length = float(raw.get("length") or 0)
    except (TypeError, ValueError):
        length = 0.0
    if kind in ("screw", "standoff"):
        length = min(max(length or 10.0, 3.0), 120.0)
    return {"kind": kind, "size": size, "length": length}


def envelope(spec: dict) -> list[float]:
    """Bounding size of the template as built (centred on X/Y, from z = 0)."""
    head_d, head_h, nut_af, nut_h, washer_od, washer_t, _ = METRIC[spec["size"]]
    kind = spec["kind"]
    if kind == "screw":
        return [head_d, head_d, spec["length"] + head_h]
    across_corners = nut_af / 0.8660254
    if kind == "nut":
        return [across_corners, nut_af, nut_h]
    if kind == "washer":
        return [washer_od, washer_od, washer_t]
    return [across_corners, nut_af, spec["length"]]


def name(spec: dict) -> str:
    size, kind = spec["size"], spec["kind"]
    if kind == "screw":
        return f"{size}×{spec['length']:g} socket head screw"
    if kind == "standoff":
        return f"{size}×{spec['length']:g} hex standoff"
    return f"{size} {'hex nut' if kind == 'nut' else 'washer'}"


def ports(spec: dict) -> dict[str, dict]:
    """The port frames a template declares (in the part's own frame), so a
    plan can be checked against them before anything is built."""
    _, _, _, nut_h, _, washer_t, _ = METRIC[spec["size"]]
    down, up, ref = [0.0, 0.0, -1.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]
    kind = spec["kind"]
    if kind == "screw":
        return {"seat": {"origin": [0.0, 0.0, spec["length"]], "axis": down, "ref": ref},
                "tip": {"origin": [0.0, 0.0, 0.0], "axis": down, "ref": ref}}
    height = {"nut": nut_h, "washer": washer_t}.get(kind, spec["length"])
    low, high = ("bottom", "top") if kind == "standoff" else ("seat", "top")
    tapped = {"size": spec["size"], "depth": min(6.0, height / 2)} if kind == "standoff" else None
    return {low: {"origin": [0.0, 0.0, 0.0], "axis": down, "ref": ref, **({"tapped": tapped} if tapped else {})},
            high: {"origin": [0.0, 0.0, height], "axis": up, "ref": ref, **({"tapped": tapped} if tapped else {})}}


def code(spec: dict) -> str:
    d = float(spec["size"][1:])
    head_d, head_h, nut_af, nut_h, washer_od, washer_t, hole = METRIC[spec["size"]]
    if spec["kind"] == "screw":
        return f'''# {name(spec)} (ISO 4762), threads not modelled
d = {d}
length = P("length", {spec["length"]}, min=3, max=120)
head_d = {head_d}
head_h = {head_h}
shank = cq.Workplane("XY").circle(d / 2).extrude(length)
head = (cq.Workplane("XY").workplane(offset=length).circle(head_d / 2).extrude(head_h)
        .faces(">Z").workplane().polygon(6, d * 0.5 / math.cos(math.pi / 6)).cutBlind(-head_h * 0.6))
result = shank.union(head)
PORT("seat", (0, 0, length), axis=(0, 0, -1), ref=(1, 0, 0))
PORT("tip", (0, 0, 0), axis=(0, 0, -1), ref=(1, 0, 0))
'''
    if spec["kind"] == "nut":
        return f'''# {name(spec)} (ISO 4032)
d = {d}
across_flats = {nut_af}
height = {nut_h}
result = (cq.Workplane("XY").polygon(6, across_flats / math.cos(math.pi / 6)).extrude(height)
          .faces(">Z").workplane().hole(d))
PORT("seat", (0, 0, 0), axis=(0, 0, -1), ref=(1, 0, 0))
PORT("top", (0, 0, height), axis=(0, 0, 1), ref=(1, 0, 0))
'''
    if spec["kind"] == "washer":
        return f'''# {name(spec)} (ISO 7089)
inner = {hole}
outer = {washer_od}
thickness = {washer_t}
result = cq.Workplane("XY").circle(outer / 2).circle(inner / 2).extrude(thickness)
PORT("seat", (0, 0, 0), axis=(0, 0, -1), ref=(1, 0, 0))
PORT("top", (0, 0, thickness), axis=(0, 0, 1), ref=(1, 0, 0))
'''
    return f'''# {name(spec)}, female-female
d = {d}
across_flats = {nut_af}
length = P("length", {spec["length"]}, min=3, max=120)
result = (cq.Workplane("XY").polygon(6, across_flats / math.cos(math.pi / 6)).extrude(length)
          .faces(">Z").workplane().hole(d))  # tapped: threads not modelled, so a screw threads in without touching
PORT("bottom", (0, 0, 0), axis=(0, 0, -1), ref=(1, 0, 0))
PORT("top", (0, 0, length), axis=(0, 0, 1), ref=(1, 0, 0))
'''
