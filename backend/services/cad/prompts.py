"""Prompts for CAD Studio's planner and part writer."""
import json
from typing import Optional

CODE_SYSTEM = (
    "You are an expert mechanical designer who writes clean, robust CadQuery code. "
    "You answer with a single python code block."
)

CODE_RULES = """Write a CadQuery (Python) script for ONE part.

Rules:
- `cq` (cadquery) and `math` are already imported; you may also `import cadquery as cq`.
- Units are millimetres. Z points up.
- Build the part at its own origin: centred on X/Y, resting on Z = 0 (its lowest point at z = 0).
  The assembly places it later, so never translate it to its final position.
- Every meaningful dimension is a tunable parameter declared with
  `P(name, default, min=None, max=None)`, e.g. `width = P("width", 40.0, min=5, max=500)`.
  Use snake_case names, floats for lengths, ints for counts. Declare them at the top.
- Assign the final solid to a module-level variable named `result` (Workplane or Shape).
- One solid if possible. Keep it under ~80 lines. No file I/O, no exports, no prints,
  no `if __name__ == "__main__"`, no imports other than cadquery/math.
- Prefer robust operations: box/cylinder/extrude/revolve/loft, `.hole()`, `.cboreHole()`,
  `.pushPoints()`/`.rarray()`/`.polarArray()` for patterns, small fillets/chamfers last
  and only on edges you are sure exist (a failing fillet breaks the whole part).
- Return ONLY one ```python``` code block, no explanation."""


PLANNER_SYSTEM = """You plan 3D models for a parametric CAD tool.

Split the request into the distinct physical parts that would be manufactured separately
(1 part for a simple object, up to 8 for an assembly). Each part is modelled on its own,
at its own origin (centred on X/Y, resting on Z = 0, Z up, millimetres), then placed in the
assembly with a position (mm) and rotation (degrees, Euler XYZ) of that origin.

Answer ONLY with JSON:
{
  "name": "short assembly name",
  "parts": [
    {
      "id": "snake_case_id",
      "name": "Human name",
      "description": "What it is, its key dimensions in mm and features, specific enough to model it alone",
      "position": [x, y, z],
      "rotation": [rx, ry, rz],
      "color": "#rrggbb",
      "count": 1
    }
  ]
}

Rules:
- Use realistic dimensions and make the parts fit each other (matching hole spacings, shaft
  diameters, thicknesses). Put shared dimensions in every description that needs them.
- Placement must be consistent: e.g. a lid on a 40 mm tall box sits at z = 40.
- Identical parts (wheels, screws) are ONE part with "count" > 1; give the positions of all
  copies as "positions": [[x,y,z], ...] (and optional "rotations") instead of "position".
- Distinct, muted engineering colours."""


def planner_user(prompt: str, existing: list[dict]) -> str:
    context = ""
    if existing:
        listing = "\n".join(
            f"- {p['name']} (size {p.get('size')}) at {p.get('position')}" for p in existing
        )
        context = (
            "\n\nThe assembly already contains these parts (don't recreate them; place new parts "
            f"relative to them):\n{listing}"
        )
    return f"Request: {prompt}{context}"


def part_user(name: str, description: str, overall: str) -> str:
    return (
        f"{CODE_RULES}\n\nThis part belongs to: {overall}\n"
        f"Part: {name}\nDescription: {description}"
    )


def fix_user(code: str, error: str) -> str:
    return (
        f"{CODE_RULES}\n\nThis part script failed:\n```python\n{code}\n```\n\n"
        f"Error:\n```\n{error[-3000:]}\n```\n\n"
        "Fix it. Keep the same design and parameter names; change only what is needed. "
        "If a fillet or chamfer fails, reduce or remove it."
    )


def edit_user(code: str, instruction: str, meta: Optional[dict], face: Optional[dict]) -> str:
    parts = [
        CODE_RULES,
        f"\nCurrent part script:\n```python\n{code}\n```",
    ]
    if meta:
        parts.append(f"Current bounding box (mm): {json.dumps(meta.get('bbox'))}")
    if face:
        parts.append(
            "The user selected this face of the part: "
            f"type {face.get('type')}, centre {face.get('center')}, outward normal {face.get('normal')}, "
            f"area {face.get('area')} mm². Select it in code with e.g. "
            f"`.faces(cq.selectors.NearestToPointSelector({tuple(face.get('center') or (0, 0, 0))}))`."
        )
    parts.append(
        f"\nChange requested: {instruction}\n\n"
        "Return the complete updated script. Keep existing parameters unless the change needs new ones."
    )
    return "\n".join(parts)


def imported_code(kind: str, asset_name: str) -> str:
    """Starting script for an imported file; edits add operations on top."""
    if kind == "step":
        return f'base = cq.importers.importStep(ASSET("{asset_name}"))\n\nresult = base\n'
    if kind == "iges":
        return f'base = cq.Workplane(obj=IGES(ASSET("{asset_name}")))\n\nresult = base\n'
    if kind == "mesh":
        return (
            "# Imported mesh: it is made of flat triangles, so it can be placed, scaled and\n"
            "# combined, but its faces are not editable features.\n"
            'scale = P("scale", 1.0, min=0.001, max=1000, unit="x")\n'
            f'mesh = MESH(ASSET("{asset_name}"))\n'
            "result = mesh.scale(scale) if scale != 1.0 else mesh\n"
        )
    if kind == "dxf":
        return (
            "# Imported 2D drawing, extruded into a plate.\n"
            'thickness = P("thickness", 3.0, min=0.2, max=500)\n'
            f'sketch = cq.importers.importDXF(ASSET("{asset_name}"))\n'
            "result = sketch.wires().toPending().extrude(thickness)\n"
        )
    raise ValueError(kind)
