"""
Standard fasteners, built from fixed templates instead of by a part agent.

Sizes follow ISO 4762 (socket head cap screws), ISO 4032 (hex nuts),
ISO 7089 (washers) and common female-female hex standoffs. Threads are not
modelled: a screw's shank has the nominal diameter, so it passes through a
clearance hole without touching it and the interference check stays clean.

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
    "M2": (3.8, 2.0, 4.0, 1.6, 5.0, 0.3, 2.4),
    "M2.5": (4.5, 2.5, 5.0, 2.0, 6.0, 0.5, 2.9),
    "M3": (5.5, 3.0, 5.5, 2.4, 7.0, 0.5, 3.4),
    "M4": (7.0, 4.0, 7.0, 3.2, 9.0, 0.8, 4.5),
    "M5": (8.5, 5.0, 8.0, 4.7, 10.0, 1.0, 5.5),
    "M6": (10.0, 6.0, 10.0, 5.2, 12.0, 1.6, 6.6),
}
KINDS = {"screw", "nut", "washer", "standoff"}
COLORS = {"screw": "#9aa0a6", "nut": "#8a9096", "washer": "#b0b5ba", "standoff": "#c9a24a"}


def clearance_table() -> str:
    return ", ".join(f"{size}: {v[6]} mm" for size, v in METRIC.items())


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


def name(spec: dict) -> str:
    size, kind = spec["size"], spec["kind"]
    if kind == "screw":
        return f"{size}×{spec['length']:g} socket head screw"
    if kind == "standoff":
        return f"{size}×{spec['length']:g} hex standoff"
    return f"{size} {'hex nut' if kind == 'nut' else 'washer'}"


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
          .faces(">Z").workplane().hole(d * 0.85))
PORT("bottom", (0, 0, 0), axis=(0, 0, -1), ref=(1, 0, 0))
PORT("top", (0, 0, length), axis=(0, 0, 1), ref=(1, 0, 0))
'''
