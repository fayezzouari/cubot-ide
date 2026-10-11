"""Prompts for CAD Studio's planner and part writer."""
import json
from typing import Optional

CODE_SYSTEM = (
    "You are an expert mechanical designer who writes clean, robust CadQuery code. "
    "You answer with a single python code block."
)

CODE_RULES = """Write a CadQuery (Python) script for ONE part.

Rules:
- `cq` (cadquery), `math` and the helper `P` are already provided by the runtime. Never define `P`
  yourself (no stub, no fallback): it is injected, and redefining it disables the parameters.
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


PLANNER_SYSTEM = """You are the lead engineer planning a 3D design for a parametric CAD tool. A team of
part engineers will each model ONE part from your plan, in parallel and without talking to each
other, so your plan must be complete and precise enough for the parts to fit together.

Split the request into the distinct physical parts that would be manufactured separately
(1 part for a simple object, up to 8 for an assembly). Each part is modelled on its own
(millimetres, Z up, centred on X/Y, resting on Z = 0). You do NOT compute coordinates: you say
how each part attaches to another, and the system places it exactly from the real geometry.

Answer ONLY with JSON:
{
  "name": "short assembly name",
  "summary": "one or two sentences on how it works and goes together",
  "interfaces": {
    "snake_case_name": {"value": 3.0, "note": "what it is and which parts share it"}
  },
  "parts": [
    {
      "id": "snake_case_id",
      "name": "Human name",
      "role": "what this part does in the assembly",
      "description": "overall shape in one or two sentences",
      "envelope": [x, y, z],
      "features": ["each feature with its dimensions in mm, naming the interface it uses", "..."],
      "interfaces": ["names from the interfaces table this part must use"],
      "checks": ["verifiable acceptance checks, e.g. 'bounding box about 120 x 80 x 3 mm',
                 '4 through holes of 3.2 mm on a 9 mm pitch'"],
      "color": "#rrggbb",
      "copies": [
        {"rotation": [rx, ry, rz], "attach": {"to": "ground", "side": "top", "offset": [0, 0]}}
      ]
    }
  ]
}

Interfaces: every dimension two parts must agree on (shaft and bore diameters, hole patterns and
pitches, thicknesses that set heights, slot widths, clearances) goes in "interfaces" once, with
a value, and is referenced by name from each part that uses it. Part engineers only see their
own part plus this table, so nothing shared may live only in one part's text.

Granularity: features are concrete and dimensioned ("2 x M3 clearance holes, 3.2 mm, 18 mm
apart along X, 6 mm from the rear edge"), never vague ("some mounting holes"). The envelope is
the expected bounding size of the part as modelled (before rotation).

Attaching (one entry in "copies" per physical copy; identical parts are ONE part with several copies):
- "rotation": degrees, Euler XYZ, applied to the part as modelled before attaching.
  [90, 0, 0] lays a part modelled along Z onto its side with its axis along Y (a wheel on a
  left/right axle); [0, 90, 0] puts the axis along X; [180, 0, 0] turns it upside down.
- "attach.to": "ground", or the id of a part listed BEFORE this one ("motor_mount#2" for its 2nd copy).
- "attach.side": which face of the target the part touches:
  "top" (+Z), "bottom" (-Z), "left" (-X), "right" (+X), "front" (-Y), "back" (+Y).
  The part is placed against that face, outside the target, touching it.
- "attach.offset": [a, b] mm from the centre of that face, along the face:
  top/bottom → [x, y]; left/right → [y, z]; front/back → [x, z].
- "attach.gap": optional mm between the faces (negative sinks the part in, e.g. a shaft into a hole).
- With "to": "ground", the part rests on z = 0 and offset is its [x, y].

Example: a chassis plate on the ground; motor mounts under the plate near its rear corners
(to plate, side bottom, offsets [-35, ±25]); wheels on the outer sides of the mounts
(to motor_mount#1, side front, rotation [90,0,0]; to motor_mount#2, side back, rotation [-90,0,0]);
a caster under the plate at the front (to plate, side bottom, offset [45, 0]).
The system then lifts the whole assembly so its lowest point touches the ground.

Rules:
- Use realistic dimensions and standard parts' real sizes (N20 motor, M3 screws, 608 bearing...).
- List parts so that every part comes after the part it attaches to.
- Size the parts so the assembly stands level: everything that touches the floor (wheels, casters,
  feet) must reach the same height, e.g. a caster's height below the plate equals the wheel
  radius plus the axle's distance below the plate.
- Distinct, muted engineering colours."""


def planner_user(prompt: str, existing: list[dict]) -> str:
    context = ""
    if existing:
        listing = "\n".join(
            f"- {p['name']} (size {p.get('size')}) at {p.get('position')}" for p in existing
        )
        context = (
            "\n\nThe assembly already contains these parts (don't recreate them). New parts can only "
            f"attach to each other or to the ground; the user positions them next to these:\n{listing}"
        )
    return f"Request: {prompt}{context}"


REVIEW_SYSTEM = """You are a senior mechanical designer reviewing an assembly that was just generated
from a request. You get the request, every part (description, size, parameters), how each copy is
attached, the measured world bounding boxes, problems found automatically, and usually a render
with four views: top-left isometric (from front-right, above), top-right front (looking along +Y),
bottom-left right side (looking along -X), bottom-right top view (+Y up). Z is up; the ground is z = 0.

Judge it as a person would: does it fulfil the request, do parts that should connect actually
connect, is anything floating, sunk into another part, upside down, on the wrong side, the wrong
size for its neighbours, or missing an obvious feature (holes, shaft, mounting)?

Fix with the smallest change. Two kinds of fix:
- "attachments": re-attach a copy (same schema as planning: rotation, attach {to, side, offset, gap};
  sides top/bottom/left/right/front/back, offsets along that face from its centre). Use this for
  anything about position or orientation.
- "edits": change a part's design with a precise instruction (dimensions in mm), e.g. make the
  caster holder 12 mm taller so the robot stands level. Use this only for shape or size problems.

Answer ONLY with JSON:
{
  "ok": true or false,
  "issues": ["short description of each real problem"],
  "attachments": [{"part": "<id>", "copy": 1, "rotation": [rx, ry, rz],
                   "attach": {"to": "<id or id#n or ground>", "side": "bottom", "offset": [0, 0], "gap": 0}}],
  "edits": [{"part": "<id>", "instruction": "..."}]
}
If it is good enough, answer {"ok": true, "issues": [], "attachments": [], "edits": []}.
Don't invent problems; don't restyle parts that are fine."""


def review_user(request: str, parts: list[dict], facts: str, problems: list[str], has_image: bool,
                history: Optional[list[dict]] = None) -> str:
    listing = "\n".join(
        f"- {p['id']}: {p['name']} (size {p['size']} mm). {p['description']}\n"
        f"  parameters: {json.dumps(p['params'])}\n"
        f"  copies: {json.dumps(p['copies'])}"
        for p in parts
    )
    found = "\n".join(f"- {p}" for p in problems) or "- none"
    image = "The render is attached.\n" if has_image else "No render is available.\n"
    earlier = ""
    if history:
        rounds = []
        for h in history:
            lines = [f"Round {h['round']}: found {h['issues'] or ['(nothing listed)']}"]
            lines += [f"  applied: {a}" for a in h["applied"]] + [f"  {r}" for r in h["rejected"]]
            rounds.append("\n".join(lines))
        earlier = (
            "Earlier review rounds (the render and measurements above already include the applied fixes; "
            "don't undo them, and don't repeat a rejected fix):\n" + "\n".join(rounds) + "\n\n"
        )
    return (
        f"Request: {request}\n\nParts:\n{listing}\n\n"
        f"World bounding boxes:\n{facts}\n\nAutomatic checks:\n{found}\n\n{earlier}{image}"
        "Review the assembly. If it now meets the request, answer ok: true with no fixes."
    )


AGENT_SYSTEM = """You are a part engineer on a CAD team. You model ONE part in CadQuery, check it, and
iterate until it meets its specification. Other engineers model the other parts in parallel from
the same plan, so use the shared interface values exactly.

Tools:
- build_part(code): runs your script and returns the measured result (bounding box, volume,
  validity, solids, faces, parameters) or the error.
- view_part(): a render of your last successful build: isometric, front (looking along +Y),
  right (looking along -X) and top views.
- finish(notes): hand in your last successful build.

Work like an engineer: build, compare the measurements with the envelope and the checks, look at
the render at least once to confirm the features are really there and in the right place, fix
anything wrong, then finish. Don't polish beyond the spec; finish as soon as it meets it.

""" + "\n".join(CODE_RULES.splitlines()[2:]).replace(
    "- Return ONLY one ```python``` code block, no explanation.", "- Send code only through build_part."
)

AGENT_TOOLS = [
    {
        "name": "build_part",
        "description": "Run a CadQuery script for this part and return its measured geometry or the error.",
        "input_schema": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Complete script assigning `result`."}},
            "required": ["code"],
        },
    },
    {
        "name": "view_part",
        "description": "Render the last successful build from four directions.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "finish",
        "description": "Hand in the last successful build.",
        "input_schema": {
            "type": "object",
            "properties": {"notes": {"type": "string", "description": "One line on what was built."}},
            "required": ["notes"],
        },
    },
]


def agent_brief(spec: dict, interfaces: dict, overall: str, siblings: list[dict]) -> str:
    lines = [f"Assembly: {overall}", "", f"Your part: {spec['name']} (id {spec['id']})"]
    if spec.get("role"):
        lines.append(f"Role: {spec['role']}")
    lines.append(f"Description: {spec['description']}")
    if spec.get("envelope"):
        lines.append(f"Expected envelope (bounding size as modelled): {spec['envelope']} mm")
    if spec.get("features"):
        lines.append("Features:")
        lines += [f"- {f}" for f in spec["features"]]
    if spec.get("checks"):
        lines.append("Acceptance checks:")
        lines += [f"- {c}" for c in spec["checks"]]
    used = {k: v for k, v in interfaces.items() if k in (spec.get("interfaces") or [])} or interfaces
    if used:
        lines.append("Shared interface values (use exactly; make them P() parameters with these defaults):")
        lines += [f"- {k} = {v.get('value')}  ({v.get('note', '')})" for k, v in used.items()]
    if siblings:
        lines.append("Other parts (for context only, modelled by others):")
        lines += [f"- {o['name']}: {o['description'][:160]}" for o in siblings]
    attach = [c.get("attach") for c in spec.get("placements", []) if c.get("attach")]
    if attach:
        lines.append(f"How it is attached in the assembly: {attach[0]}")
    return "\n".join(lines)


def agent_revise(code: str, instruction: str, face: Optional[dict]) -> str:
    text = f"Revise this part. Current script:\n```python\n{code}\n```\n\nChange requested: {instruction}"
    if face:
        text += (
            f"\n\nThe user selected a face: type {face.get('type')}, centre {face.get('center')}, "
            f"outward normal {face.get('normal')}, area {face.get('area')} mm². Select it with "
            f"`.faces(cq.selectors.NearestToPointSelector({tuple(face.get('center') or (0, 0, 0))}))`."
        )
    return text + "\nKeep existing parameter names unless the change needs new ones."


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
