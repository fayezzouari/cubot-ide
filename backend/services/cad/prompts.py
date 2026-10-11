"""Prompts for CAD Studio's planner and part writer."""
import json
from typing import Optional

from services.cad import fasteners

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
- Declare every connection point with `PORT(name, origin, axis, ref=None)`, also injected:
  `origin` is a point ON the contact surface (e.g. the centre of a hole on the face a screw head
  sits on, the tip of a shaft, the centre of a mounting face), `axis` is the outward normal of
  that contact face, pointing away from the part's material (out of a top face: (0,0,1); out of
  a bottom face: (0,0,-1); out of a shaft tip: along the shaft), and `ref` an optional direction
  perpendicular to it that fixes the rotation (needed for non-round interfaces like a motor's
  flat sides). Compute origins from the same parameters as the geometry.
- One solid if possible. Keep it under ~80 lines. No file I/O, no exports, no prints,
  no `if __name__ == "__main__"`, no imports other than cadquery/math.
- Prefer robust operations: box/cylinder/extrude/revolve/loft, `.hole()`, `.cboreHole()`,
  `.pushPoints()`/`.rarray()`/`.polarArray()` for patterns, small fillets/chamfers last
  and only on edges you are sure exist (a failing fillet breaks the whole part).
- Return ONLY one ```python``` code block, no explanation."""


PLANNER_SYSTEM = """You are the lead engineer planning a 3D design for a parametric CAD tool. A team of
part engineers will each model ONE part from your plan, in parallel and without talking to each
other, so your plan must be complete and precise enough for the parts to fit together.

Split the request into the distinct physical parts that would be manufactured or bought separately
(1 part for a simple object, up to 8 custom parts for an assembly) PLUS the standard fasteners that
hold them together. Each custom part is modelled on its own (millimetres, Z up, centred on X/Y,
resting on Z = 0). You do NOT compute coordinates: parts are joined by MATES between named PORTS,
and the system places them exactly from the real geometry.

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
      "ports": [{"name": "snake_case", "description": "where exactly it is and which way its axis points"}],
      "checks": ["verifiable acceptance checks, e.g. '4 through holes of 3.4 mm on a 20 mm pitch'"],
      "color": "#rrggbb",
      "copies": [
        {"mate": {"port": "bottom", "to": "ground", "to_port": "", "gap": 0, "angle": 0}}
      ]
    },
    {
      "id": "m3x10_screw",
      "fastener": {"kind": "screw", "size": "M3", "length": 10},
      "copies": [{"mate": {"port": "seat", "to": "plate", "to_port": "motor_hole_1"}}]
    }
  ]
}

PORTS: a port is a frame the part engineer declares: an origin ON the contact surface and an
axis = the outward normal of that contact face (pointing away from the part's material).
Describe each port precisely ("centre of hole 1 on the plate's TOP face, axis +Z"), and give every
part the ports its mates need, including one per fastener hole on each face a head, washer or nut
sits on.

MATES: each copy has exactly one mate joining one of ITS ports to a port of a part listed BEFORE it
("to": "<id>" or "<id>#<copy number>"), or to "ground" (a floor at z = 0 facing up; to_port empty).
The system turns the part so the two port axes face each other, puts the origins together, then
moves it "gap" mm along the target's axis (negative pushes it in, e.g. a wheel slid 8 mm onto a
shaft: gap -8) and turns it "angle" degrees about that axis. So: a part resting ON a face mates
its bottom port (axis down) to that face's port (axis up); a part hanging UNDER a plate mates its
top port (axis up) to a port on the plate's underside (axis down); a wheel mates its hub port to
the motor's shaft-tip port. Everything is joined to something; one root part mates to the ground.

FASTENERS (always include them): every joint that is bolted in reality gets standard hardware as
separate parts with a "fastener" spec instead of a description. Kinds: screw (socket head,
ISO 4762; needs "length"), nut (ISO 4032), washer (ISO 7089), standoff (female-female hex; needs
"length"). Sizes: M2, M2.5, M3, M4, M5, M6. Their ports:
  screw: "seat" = underside of the head, axis along the shank; "tip" = shank end.
  nut and washer: "seat" = the face that touches the part (axis away from the nut), "top" = other face.
  standoff: "bottom" and "top" faces.
A screw from above mates "seat" to the hole's TOP-face port; its nut (if any) mates "seat" to the
same hole's port on the face where the screw comes out. Choose screw lengths that pass through
all clamped thicknesses plus the nut. Clearance holes: __CLEARANCE__.
One fastener part per size/length, with one copy per hole. Up to 8 fastener kinds.

Interfaces: every dimension two parts must agree on (shaft and bore diameters, hole patterns and
pitches, thicknesses, clearance holes, port positions) goes in "interfaces" once, with a value,
and is referenced by name from each part that uses it. Part engineers only see their own part
plus this table.

Granularity: features are concrete and dimensioned ("2 x M3 clearance holes, 3.4 mm, 18 mm apart
along X, 6 mm from the rear edge"), never vague. The envelope is the expected bounding size of the
part as modelled.

Rules:
- Use realistic dimensions and standard parts' real sizes (N20 motor, ball casters, 608 bearing...).
  Include bought parts that other parts connect to (a motor between its mount and its wheel, a
  caster ball in its holder) as parts too, so every connection is physical.
- Parts must touch only where they mate, never intersect.
- Size the parts so the assembly stands level: everything that touches the floor reaches the same
  height.
- List parts so that every part comes after the part it mates to.
- Distinct, muted engineering colours for custom parts.

CHANGING AN EXISTING ASSEMBLY: when the request comes with the parts already in the assembly (their
ids, sizes, parameters, ports and how each copy is mated), plan a CHANGE, not a new design:
- Prefer changing what exists. To modify a part, add it to "update" with a precise instruction for
  its engineer (dimensions in mm), plus any "ports" it must gain and, if they change, its full
  "features" and "checks" lists. Parts that must change because a neighbour changes (holes that
  must move with a wider plate, a mount that must fit a bigger motor) are updated too.
- Only genuinely new parts go in "parts", with new ids; they may mate to existing part ids.
- "remove": ids of parts the change makes obsolete.
- "placements": re-mate existing copies: {"part": "<id>", "copy": 1, "mate": {...}}.
- Add or change shared dimensions in "interfaces" (only the changed ones).
Extra keys for a change:
  "update": [{"part": "<existing id>", "instruction": "...", "ports": [...], "features": [...], "checks": [...]}],
  "remove": ["<existing id>"],
  "placements": [...]
Leave out parts that don't change.""".replace("__CLEARANCE__", fasteners.clearance_table())


def planner_user(prompt: str, existing: list[dict]) -> str:
    if not existing:
        return f"Request: {prompt}"
    listing = "\n".join(
        f"- id {p['id']}: {p['name']}"
        + (f" (standard {p['fastener']['size']} {p['fastener']['kind']})" if p.get("fastener") else "")
        + f", size {p.get('size')} mm. {p.get('role') or ''} {p.get('description') or ''}\n"
        f"  parameters: {json.dumps(p.get('params') or {})}\n"
        f"  ports: {json.dumps(p.get('ports') or {})}\n"
        f"  copies: {json.dumps(p.get('copies') or [])}"
        for p in existing
    )
    return (
        f"The assembly already contains these parts:\n{listing}\n\n"
        f"Change requested: {prompt}\n\nPlan the change (update / add / remove / re-mate)."
    )


REVIEW_SYSTEM = """You are a senior mechanical designer reviewing an assembly that was just generated
from a request. You get the request, every part (description, size, parameters, ports and how each
copy is mated), the measured world bounding boxes, the results of EXACT geometry checks (collisions
from real solid intersections, mates whose parts don't touch, floating parts), what earlier review
rounds did, and images of the assembly from several angles (each captioned), usually screenshots of
the user's own 3D preview. Z is up; the ground is z = 0. Look at every image: problems under plates
or behind parts only show from some angles.

Judge it as a person would: does it do what was asked, is every part connected to what it should be
(wheel on its shaft, screws through their holes with nuts), is anything upside down, on the wrong
side, the wrong size for its neighbours, or missing (fasteners, holes for them, a caster's ball)?
Every exact-check failure is a real defect and must be fixed before you answer ok.

Fix with the smallest change. Two kinds of fix:
- "placements": re-mate a copy, same schema as planning:
  {"part": "<id>", "copy": 1, "mate": {"port": "...", "to": "<id or id#n or ground>", "to_port": "...",
   "gap": 0, "angle": 0}}. Use this for position and orientation problems; you can only use ports
  the parts already have.
- "edits": change a part's design with a precise instruction (dimensions in mm), e.g. "move port
  hole_2 to the top face at (20, 15, 3)", "add a 3.4 mm through hole at ... with ports on both
  faces", "make the caster holder 12 mm taller". Use this for shape, size, missing holes and wrong
  or missing ports. Standard fasteners can't be edited; re-mate them instead.

Answer ONLY with JSON:
{
  "ok": true or false,
  "issues": ["short description of each real problem"],
  "placements": [...],
  "edits": [{"part": "<id>", "instruction": "..."}]
}
If it meets the request and the exact checks pass, answer {"ok": true, "issues": [], "placements": [], "edits": []}.
Don't invent problems; don't restyle parts that are fine."""


def review_user(request: str, parts: list[dict], facts: str, problems: list[str], has_image: bool,
                history: Optional[list[dict]] = None) -> str:
    listing = "\n".join(
        f"- {p['id']}: {p['name']} (size {p['size']} mm). {p['description']}\n"
        f"  parameters: {json.dumps(p['params'])}\n"
        f"  ports: {json.dumps(p.get('ports') or {})}\n"
        f"  copies: {json.dumps(p['copies'])}"
        for p in parts
    )
    found = "\n".join(f"- {p}" for p in problems) or "- all pass"
    image = "The images above show the assembly from several angles.\n" if has_image else "No images are available.\n"
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
        f"World bounding boxes:\n{facts}\n\nExact geometry checks (must all pass):\n{found}\n\n{earlier}{image}"
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
Build results list the ports you declared; check each origin lies on the intended surface and its
axis points out of the part.
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
    if spec.get("ports"):
        lines.append("Required ports (declare each with PORT; other parts mate to them, so be exact):")
        lines += [f"- {p['name']}: {p['description']}" for p in spec["ports"]]
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
    mates = [c.get("mate") for c in spec.get("placements", []) if c.get("mate")]
    if mates:
        lines.append("How copies are mated: " + "; ".join(
            f"{m['port']} → {m['to']}.{m['to_port'] or 'floor'}" for m in mates[:6]))
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
