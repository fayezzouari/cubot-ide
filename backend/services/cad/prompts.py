"""Prompts for CAD Studio's planner and part writer."""
import json
from typing import Optional

from services.cad import catalog, fasteners

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


_MATE_SCHEMA = {
    "type": "object",
    "properties": {
        "port": {"type": "string"},
        "to": {"type": "string", "description": "part id, part id#copy number, or ground"},
        "to_port": {"type": "string"},
        "gap": {"type": "number"},
        "angle": {"type": "number"},
        "joint": {"type": "string", "enum": ["fixed", "revolute"]},
    },
    "required": ["port", "to", "to_port"],
}
_COPY_SCHEMA = {
    "type": "object",
    "properties": {"mate": _MATE_SCHEMA, "also": {"type": "array", "items": _MATE_SCHEMA}},
    "required": ["mate"],
}
_PORT_NAME_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string", "description": "which feature, which face, which way the axis points"},
        "meets": {"type": "string", "description": "part.port it touches, or ground, or empty"},
        "tapped": {"type": "object", "properties": {"size": {"type": "string"}, "depth": {"type": "number"}},
                   "required": ["size", "depth"]},
    },
    "required": ["name", "description"],
}

ARCHITECTURE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "style": {
            "type": "object",
            "description": "manufacturing style every custom part follows",
            "properties": {
                "material": {"type": "string"},
                "wall": {"type": "number", "description": "minimum wall thickness, mm"},
                "fillet": {"type": "number", "description": "outer edge fillet radius, mm (0 for none)"},
                "clearance": {"type": "number", "description": "running clearance between moving parts, mm"},
                "notes": {"type": "string"},
            },
            "required": ["material", "wall", "fillet", "clearance"],
        },
        "interfaces": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "properties": {"value": {"type": "number"}, "note": {"type": "string"}},
                "required": ["value", "note"],
            },
        },
        "components": {
            "type": "array",
            "description": "bought parts from the catalog",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "component": {"type": "string", "description": "catalog id"},
                    "role": {"type": "string"},
                    "copies": {"type": "array", "items": _COPY_SCHEMA},
                },
                "required": ["id", "component", "copies"],
            },
        },
        "hardware": {
            "type": "array",
            "description": "standoffs, washers and nuts placed on their own (screws are derived, not listed here)",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "fastener": {"type": "object", "properties": {
                        "kind": {"type": "string", "enum": ["standoff", "washer", "nut"]},
                        "size": {"type": "string"}, "length": {"type": "number"}}, "required": ["kind", "size"]},
                    "copies": {"type": "array", "items": _COPY_SCHEMA},
                },
                "required": ["id", "fastener", "copies"],
            },
        },
        "parts": {
            "type": "array",
            "description": "custom parts, each one manufactured piece",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "role": {"type": "string"},
                    "description": {"type": "string"},
                    "envelope": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "interfaces": {"type": "array", "items": {"type": "string"}},
                    "ports": {"type": "array", "items": _PORT_NAME_SCHEMA},
                    "copies": {"type": "array", "items": _COPY_SCHEMA},
                    "manufacturing": {"type": "string"},
                    "color": {"type": "string"},
                },
                "required": ["id", "name", "role", "description", "envelope", "ports", "copies"],
            },
        },
        "screws": {
            "type": "array",
            "description": "every screw: where its head sits and what it threads into or clamps with a nut",
            "items": {
                "type": "object",
                "properties": {
                    "size": {"type": "string"},
                    "head_on": {"type": "string", "description": "part.port (copy as part#n.port) the head sits on"},
                    "into": {"type": "string", "description": "tapped part.port it threads into, or empty"},
                    "nut_on": {"type": "string", "description": "part.port the nut seats on, or empty"},
                },
                "required": ["size", "head_on"],
            },
        },
        "update": {"type": "array", "items": {"type": "object", "properties": {
            "part": {"type": "string"}, "instruction": {"type": "string"},
            "ports": {"type": "array", "items": _PORT_NAME_SCHEMA}}, "required": ["part", "instruction"]}},
        "remove": {"type": "array", "items": {"type": "string"}},
        "placements": {"type": "array", "items": {"type": "object", "properties": {
            "part": {"type": "string"}, "copy": {"type": "integer"}, "mate": _MATE_SCHEMA}, "required": ["part", "mate"]}},
    },
    "required": ["name", "summary", "style", "interfaces", "components", "hardware", "parts", "screws"],
}

ARCHITECT_SYSTEM = """You are the lead mechanical engineer architecting a design for a parametric CAD tool. You
produce the ARCHITECTURE: the parts, how they join, and every shared dimension. Part engineers then
detail each custom part (features, exact port coordinates) from your architecture, in parallel and
without talking to each other, and the system places everything from port mates, derives the screws,
and checks the result with exact geometry. You never compute assembly coordinates.

Decompose finely. Every part is ONE manufactured or bought piece: a link, a bracket, a plate, a
cover, a shaft, a spacer. Never merge pieces that would be made separately, and never leave out
what a real build needs: every actuator, bearing, horn, coupler, cover, and the screws that hold
each joint. A robot arm with 5 degrees of freedom has at least 5 actuators from the catalog, their
horns, a link or bracket per joint, a base, a gripper, and screws at every flange. Aim for 15 to 30
custom parts on a mechanism, 1 to 3 on a simple object. Prefer bought parts from the catalog for
anything standard; model custom only what is specific to this design.

CATALOG (bought parts, exact geometry and ports, placed with "component"):
__CATALOG__
Hardware placed on its own: standoff (female-female hex, needs "length"), washer, nut; sizes
__SIZES__. Standoff ports: bottom, top (both tapped). Nut and washer ports: seat, top.

PORTS: every custom part declares ports: a named frame on a contact feature (centre of a hole on
the face a head sits on, a mounting face centre, a shaft tip, a bore). Here you name each port and
say precisely which feature it is and what it meets ("meets": "mg996r_1.tab_under_1"); the part
engineer computes its coordinates from your interfaces. Holes get a port on EACH face they open
onto. Tapped holes in custom parts carry "tapped": {size, depth}.

MATES: each copy has one "mate" joining one of its ports to a port of a part listed BEFORE it ("to":
"<id>" or "<id>#<copy>"), or to "ground" (floor at z = 0 facing up). Axes end up facing each other,
origins together, "gap" mm along the target's axis (negative pushes in: a shaft slid into a bore),
turned "angle" degrees. "also" lists every other contact the copy makes (a plate on four standoffs
mates to one and also touches three); the system checks they close. A mate onto a rotary port
(servo shaft, motor shaft, bearing bore) is a revolute joint: mark "joint": "revolute". Everything
is joined to something; one root part mates to the ground. List parts so each comes after what it
mates to; components and hardware may be referenced by custom parts and vice versa, order the whole
set so every target is earlier (components, hardware and parts are placed in that order, in list
order within each).

SCREWS are derived, not designed: for each screw give "size", "head_on" (the port its head sits on,
e.g. "top_plate#1.hole_1_top") and either "into" (a tapped port: standoff top, servo tab? no, a
catalog tapped port such as "nema17_1.mount_1", or a custom tapped port) or "nut_on" (the port on
the far face where the nut seats). The system measures the stack and picks the stock length.
Servo tabs are not tapped: screws go through the tab ("head_on": servo mount_n) into the bracket
below (tapped port on the bracket) or with a nut under it. Clearance holes: __CLEARANCE__.

INTERFACES: every dimension two parts must agree on (hole pitches, bore and shaft diameters,
thicknesses, offsets, lengths of links) goes in "interfaces" once with a value, referenced by name
from each part that uses it. Part engineers see only their part and this table.

STYLE: material and rules all custom parts follow (3D-printed PETG: wall 3 mm, fillet 1 mm,
clearance 0.3 mm; machined aluminium: wall 2 mm ...). Custom parts must look designed: bosses
around holes, fillets on outer edges, ribs where thin, no bare boxes.

Rules: realistic dimensions; parts touch only where they mate; the assembly stands level; distinct
muted colours for custom parts; envelope = the expected bounding size of each custom part.

CHANGING AN EXISTING ASSEMBLY: when the request lists parts already in the assembly, plan a CHANGE:
prefer "update" (part id, precise instruction in mm, and its full "ports" list only when ports move
or appear), add only genuinely new parts, "remove" obsolete ids, "placements" to re-mate copies,
and only the changed interfaces. Leave out parts that don't change.""".replace(
    "__CATALOG__", catalog.describe()).replace("__SIZES__", ", ".join(fasteners.METRIC)).replace(
    "__CLEARANCE__", fasteners.clearance_table())

PART_DETAIL_SCHEMA = {
    "type": "object",
    "properties": {
        "features": {"type": "array", "items": {"type": "string"},
                     "description": "each feature with its dimensions in mm and position"},
        "ports": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "origin": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "ref": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "description": {"type": "string"},
                    "tapped": {"type": "object", "properties": {"size": {"type": "string"}, "depth": {"type": "number"}},
                               "required": ["size", "depth"]},
                },
                "required": ["name", "origin", "axis", "description"],
            },
        },
        "checks": {"type": "array", "items": {"type": "string"}},
        "envelope": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
    },
    "required": ["features", "ports", "checks", "envelope"],
}

DETAIL_SYSTEM = """You are a mechanical engineer detailing ONE custom part of an architecture for a parametric CAD
tool. You get the assembly's summary, style and interface table, your part's role and envelope,
the ports it must have (each with what it meets), and where known, the frames of the ports it meets
on the other parts (in THOSE parts' own coordinates, for reference).

Produce, for a part engineer who will model it in CadQuery:
- "features": concrete, dimensioned ("4 x 3.4 mm through holes on a 49 x 10 mm pattern centred
  on the top face, 6 mm bosses around each"), using interface names for shared numbers and the
  style (walls, fillets, bosses, ribs). The part must be one solid, designed-looking piece.
- "ports": EVERY required port with exact "origin" and "axis" in the part's own frame: the part is
  modelled centred on X/Y with its lowest point at z = 0 (before placement). "axis" is the outward
  normal of the contact face (out of a top face: [0,0,1]; out of a bottom face: [0,0,-1]; out of
  a shaft tip: along it); "ref" is a perpendicular direction when the orientation matters (motor
  flats, rectangular mounts). Compute each origin from the envelope and the interfaces: hole 1 on
  the top face of a 60 x 40 x 3 plate with holes on 50 x 30 is [25, 15, 3] axis [0, 0, 1], and
  the same hole's port on the underside is [25, 15, 0] axis [0, 0, -1]. Ports of the same hole
  share x, y. Keep "tapped" on ports the architecture marks tapped.
- "checks": verifiable acceptance checks.
- "envelope": the bounding size the part will have as modelled.
The build is rejected if a port is more than 0.2 mm or 2° from your numbers, so be exact and
consistent with the interface values; other parts are detailed against the same numbers."""


def architect_user(prompt: str, existing: list[dict]) -> str:
    if not existing:
        return f"Request: {prompt}"
    listing = "\n".join(
        f"- id {p['id']}: {p['name']}"
        + (f" (standard {p['fastener']['size']} {p['fastener']['kind']})" if p.get("fastener") else "")
        + (f" (catalog {p['component']['id']})" if p.get("component") else "")
        + f", size {p.get('size')} mm. {p.get('role') or ''} {p.get('description') or ''}\n"
        f"  parameters: {json.dumps(p.get('params') or {})}\n"
        f"  ports: {json.dumps(p.get('ports') or {})}\n"
        f"  copies: {json.dumps(p.get('copies') or [])}"
        for p in existing
    )
    return (
        f"The assembly already contains these parts:\n{listing}\n\n"
        f"Change requested: {prompt}\n\nArchitect the change (update / add / remove / re-mate)."
    )


def detail_user(arch: dict, part: dict, interfaces: dict, partners: dict[str, dict],
                problems: Optional[list[str]] = None, previous: Optional[dict] = None) -> str:
    style = arch.get("style") or {}
    lines = [f"Assembly: {arch.get('name')}. {arch.get('summary')}",
             f"Style: {json.dumps(style)}",
             "Interfaces (shared values, use exactly):"]
    lines += [f"- {k} = {v.get('value')}  ({v.get('note', '')})" for k, v in interfaces.items()]
    lines += ["", f"Your part: {part['name']} (id {part['id']})", f"Role: {part.get('role') or ''}",
              f"Description: {part.get('description') or ''}",
              f"Expected envelope: {part.get('envelope')} mm"]
    if part.get("manufacturing"):
        lines.append(f"Manufacturing: {part['manufacturing']}")
    if part.get("interfaces"):
        lines.append(f"Interfaces this part uses: {', '.join(part['interfaces'])}")
    lines.append("Required ports (give each an exact origin and axis):")
    for p in part.get("ports") or []:
        meets = f" — meets {p['meets']}" if p.get("meets") else ""
        tapped = f" — tapped {p['tapped']['size']} {p['tapped']['depth']} mm deep" if p.get("tapped") else ""
        lines.append(f"- {p['name']}: {p.get('description') or ''}{meets}{tapped}")
    mates = [c.get("mate") for c in part.get("copies") or [] if c.get("mate")]
    if mates:
        lines.append("How copies are mated: " + "; ".join(
            f"{m['port']} → {m['to']}.{m.get('to_port') or 'floor'}" for m in mates[:6]))
    if partners:
        lines.append("Ports on other parts that yours meet (in their own frames, for reference):")
        lines += [f"- {k}: origin {v['origin']}, axis {v['axis']}" for k, v in partners.items()]
    if previous and problems:
        lines += ["", "Your previous detail:", json.dumps(previous)[:6000],
                  "The plan check found these problems; correct the port coordinates (and features) so every "
                  "contact closes:"]
        lines += [f"- {p}" for p in problems]
    return "\n".join(lines)


REVIEW_SYSTEM = """You are a senior mechanical designer reviewing an assembly that was just generated
from a request. You get the request, every part (description, size, parameters, ports and how each
copy is mated), the measured world bounding boxes, the results of EXACT geometry checks (collisions
from real solid intersections with where they are, mates and contacts whose parts don't touch,
floating parts), what earlier rounds did (automatic rounds already moved ports onto the plan and
cut clearance holes for screws from measurements; what's left needs judgement), and images of the
assembly from several angles (each captioned), usually screenshots of the user's own 3D preview.
Z is up; the ground is z = 0. Look at every image: problems under plates or behind parts only show
from some angles.

Judge it as a person would: does it do what was asked, is every part connected to what it should be
(wheel on its shaft, screws through their holes with nuts), is anything upside down, on the wrong
side, the wrong size for its neighbours, or missing (fasteners, holes for them, a caster's ball)?
For a mechanism, count the degrees of freedom: each revolute mate (listed on the copies) is one;
if the request asks for N and fewer exist, that is a defect. Screw lengths are derived by the
system from the measured stack; don't second-guess them.
Every exact-check failure is a real defect and must be fixed before you answer ok.

Fix with the smallest change. Two kinds of fix:
- "placements": re-mate a copy, same schema as planning:
  {"part": "<id>", "copy": 1, "mate": {"port": "...", "to": "<id or id#n or ground>", "to_port": "...",
   "gap": 0, "angle": 0}}. Use this for position and orientation problems; you can only use ports
  the parts already have.
- "edits": change a part's design with a precise instruction (dimensions in mm), e.g. "add a 3.4 mm
  through hole at ... with ports on both faces", "make the caster holder 12 mm taller". Use this for
  shape, size, missing holes and wrong or missing ports. When the edit moves or adds ports, give
  "ports": the part's complete port list with exact numbers in the part's own frame (origin, axis);
  those become the frames the part is built to. Standard fasteners can't be edited; re-mate them.

Answer ONLY with JSON:
{
  "ok": true or false,
  "issues": ["short description of each real problem"],
  "placements": [...],
  "edits": [{"part": "<id>", "instruction": "...",
             "ports": [{"name": "...", "origin": [x, y, z], "axis": [x, y, z], "description": "..."}]}]
}
If it meets the request and the exact checks pass, answer {"ok": true, "issues": [], "placements": [], "edits": []}.
Don't invent problems; don't restyle parts that are fine."""


REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "issues": {"type": "array", "items": {"type": "string"}},
        "placements": {"type": "array", "items": {"type": "object", "properties": {
            "part": {"type": "string"}, "copy": {"type": "integer"}, "mate": _MATE_SCHEMA},
            "required": ["part", "mate"]}},
        "edits": {"type": "array", "items": {"type": "object", "properties": {
            "part": {"type": "string"}, "instruction": {"type": "string"},
            "ports": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"},
                "origin": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                "description": {"type": "string"}}, "required": ["name", "origin", "axis"]}}},
            "required": ["part", "instruction"]}},
    },
    "required": ["ok", "issues", "placements", "edits"],
}


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
- measure_part(): the holes, bosses and main flat faces of your last build, measured from the
  solid (centre, axis, diameter, length / normal, area). Use it to verify the acceptance checks
  (hole count, diameters, pitch) instead of guessing from the render.
Build results list the ports you declared; check each origin lies on the intended surface and its
axis points out of the part. They also list any interference with the neighbouring parts (your
build is placed in the assembly and intersected with them exactly) and whether the part exceeds
its planned envelope: both block finishing. Neighbours are given in your own coordinates, so cut
their volume away (a pocket, a cutout, a shorter wall) rather than moving your part.
- finish(notes): hand in your last successful build.

Work like an engineer: build, compare the measurements with the envelope and the checks, measure
the features the checks name, look at the render at least once to confirm the features are really
there and in the right place, fix anything wrong, then finish. Don't polish beyond the spec;
finish as soon as it meets it. Follow the style: bosses around holes, fillets on outer edges
where they can't fail, walls of the stated thickness; a bare box is not a finished part.

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
        "name": "measure_part",
        "description": "Measure the last successful build: holes and bosses (centre, axis, diameter, length) "
                       "and the largest flat faces (centre, normal, area).",
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


def agent_brief(spec: dict, interfaces: dict, overall: str, siblings: list[dict],
                style: Optional[dict] = None) -> str:
    lines = [f"Assembly: {overall}", "", f"Your part: {spec['name']} (id {spec['id']})"]
    if spec.get("role"):
        lines.append(f"Role: {spec['role']}")
    lines.append(f"Description: {spec['description']}")
    if style:
        lines.append("Style (all parts): " + ", ".join(f"{k} {v}" for k, v in style.items() if v not in (None, "")))
    if spec.get("manufacturing"):
        lines.append(f"Manufacturing: {spec['manufacturing']}")
    if spec.get("envelope"):
        lines.append(f"Expected envelope (bounding size as modelled): {spec['envelope']} mm")
    if spec.get("features"):
        lines.append("Features:")
        lines += [f"- {f}" for f in spec["features"]]
    if spec.get("ports"):
        lines.append("Required ports (declare each with PORT at exactly this frame, in your part's own "
                     "coordinates; other parts are built to meet them there, and a build whose port is more "
                     "than 0.2 mm or 2° off can't be handed in):")
        for p in spec["ports"]:
            where = ""
            if p.get("origin") and p.get("axis"):
                where = f" origin {p['origin']}, axis {p['axis']}" + (f", ref {p['ref']}" if p.get("ref") else "")
            lines.append(f"- {p['name']}:{where}. {p.get('description') or ''}".replace(":. ", ": "))
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
    if spec.get("keep_out"):
        lines.append("Neighbours, in YOUR coordinates (the volume each occupies once the assembly is put "
                     "together; keep your material out of it except where you meet it at a port):")
        lines += [f"- {k}" for k in spec["keep_out"]]
        lines.append("Every build is placed among them and checked for interference; an overlapping build "
                     "can't be handed in.")
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
