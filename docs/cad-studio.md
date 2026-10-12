# CAD Studio

Generate parts from prompts, import existing ones, edit them, place them in an
assembly and export the result in formats other tools use.

## Concepts

| Thing | What it is |
|---|---|
| **Part** | One manufacturable piece. Its `source` is `generated` (from a prompt) or `imported` (from a file); its `kind` is `brep` (exact solid) or `mesh` (faceted, from STL/OBJ/3MF). |
| **Version** | An immutable snapshot of a part: its CadQuery code, parameter overrides, referenced files and the prompt that produced it. Every edit, parameter change or code change makes a new version; any version can be restored. |
| **Instance** | A placed copy of a part in the assembly: position (mm), rotation (degrees, Euler XYZ), colour and visibility. Several instances can share one part. |
| **Assembly** | The project's list of instances. Exports always use each part's current version. |

All geometry uses millimetres with Z up. A part is modelled at its own origin
(centred on X/Y, resting on Z = 0) and placed by its instance.

## Part code

Parts are plain CadQuery scripts. The runner provides:

| Name | Purpose |
|---|---|
| `cq`, `math` | CadQuery and the math module |
| `P(name, default, min=None, max=None, unit="mm")` | Declares a tunable parameter. The inspector shows it as a field; changing it rebuilds the part without the model. |
| `PORT(name, origin, axis, ref=None)` | Declares a connection point other parts mate to (see Ports and mates) |
| `ASSET(name)` | Path of a file imported with the part |
| `MESH(path)`, `IGES(path)` | Load a mesh (STL/OBJ/3MF) or IGES file as a shape |

The script assigns the final solid to `result`.

```python
width = P("width", 40.0, min=10, max=200)
holes = P("holes", 4)
result = cq.Workplane().box(width, width, 5).translate((0, 0, 2.5))
```

Imports start from a generated script (for example
`result = cq.importers.importStep(ASSET("bracket.step"))`), so prompt edits
add operations on top of the imported geometry. Meshes can be placed, scaled
and exported but have no editable features. DXF drawings become an extruded
plate with a `thickness` parameter.

## How a prompt becomes parts

```
request ─▶ architect ─▶ detailers ─▶ plan check ─▶ part agents ─▶ assembler ─▶ auto-repair ─▶ review
            parts,        one per      mates close    build, measure,  mates solved,  from            reviewer
            catalog,      custom part: on paper?      look, fix;       screws derived measurements    + fixes
            mates, joints exact ports  (re-detail)    ports hit plan   from geometry  only
```

1. **Architect.** One call to `CAD_MODEL_ID` with extended thinking (`CAD_PLAN_THINK`), answered
   through a forced tool call so the plan is valid JSON by construction (a truncated or malformed
   answer is an error, never a silently simplified build). It produces the architecture:
   - the **parts**, finely: every manufactured piece on its own (a link, a bracket, a cover), with
     role, envelope and its **port names** (what feature, what it meets)
   - **components** from the catalog (servos, horns, gear motors, steppers, bearings) by id, and
     **hardware** placed on its own (standoffs, washers, nuts)
   - how each copy is **mated**: one of its ports to a port of an earlier part or the ground,
     `also` for every other contact, and `joint: revolute` on mates that turn (a mate onto a
     rotary port, such as a servo shaft, is tagged revolute automatically)
   - every **screw** as a joint, not a part: size, the port its head sits on, and the tapped port
     it threads into or the port its nut seats on
   - the **interfaces** table (every shared dimension, once) and the **style** (material, wall,
     fillet, clearance) all custom parts follow
2. **Detailers.** One call per custom part, in parallel on the fast model: dimensioned features,
   acceptance checks and the **port frames** (origin and axis in the part's own coordinates,
   computed from the envelope and the interfaces). Catalog and hardware ports are known already.
   The frames are the skeleton: every part is built to them, which is how parts made in isolation
   end up fitting.
3. **Plan check.** Before anything is built, the plan is checked against its own numbers: every
   mate names ports that exist, every custom port has a frame, and, placing the parts by the
   planned frames alone, every `also` contact closes (within 0.5 mm and 2°). The parts named in
   the problems are detailed once more with the exact residuals. Whatever is still wrong is
   reported in the summary and left to the review.
4. **Part agents (swarm).** Each custom part gets its own tool-using agent, run concurrently with
   `asyncio` (`CAD_PARALLEL_PARTS` at a time, `CAD_AGENT_STEPS` turns each). Catalog components
   and hardware are built from templates, no agent. An agent's tools:
   - `build_part(code)`: returns the measured geometry or the error, and for every required port
     how far the declared one is from the planned frame
   - `view_part()`: a four-view render of its part
   - `measure_part()`: holes, bosses and flat faces measured from the solid, to verify the checks
   - `finish(notes)`: refused while a required port is missing, more than 0.2 mm or 2° from its
     planned frame, or not on the part's surface

   Agents must look at their render before finishing. The best build is kept if an agent runs
   out of turns. Parts that fail (for example on rate limits) are retried one at a time.
   Without a tool-capable model, parts fall back to one-shot code with error feedback.
5. **Assembler (deterministic).** Parts are joined port to port (see below): the backend solves
   the mates in order and sets each copy's position and rotation exactly. Then the screws are
   derived: for each joint the architect listed, the clamped stack is measured along the shank
   between the head port and the tapped port (plus thread engagement) or the nut port (plus the
   nut), the stock ISO length is chosen, and the screw and nut parts are built from templates
   and mated like any other part. No model decides a position or a length. Finally the assembly
   is lowered so its lowest point rests on z = 0.
6. **Automatic repair (no reviewer).** Up to `CAD_REPAIR_ROUNDS` times, the exact checks and the
   planned frames decide what is wrong and the part agents get numeric instructions, with no
   model call in between:
   - a port missing, off its planned frame or off the surface (an agent that ran out of turns,
     an older part): "put the feature and its port where the plan says"
   - an `also` contact that doesn't close: the custom part's planned port is moved onto the other
     part's port, expressed in the part's own coordinates, and the agent moves the feature there
   - a screw through solid material: the shared volume's centre and the shank axis, in the part's
     own coordinates, with the clearance diameter to drill

   The round ends with the mates solved again. A snapshot is taken before the first fix.
7. **Review (reflection loop).** The review repeats until the reviewer is satisfied. Each round
   the reviewer gets:
   - the request and the plan
   - the measured world boxes
   - automatic checks (overlaps, parts touching nothing, uneven footing)
   - screenshots of the whole assembly from six angles, taken by your open viewer with its real
     materials and lighting: isometric front-right and back-left from above, front, right, top,
     and from below (where motors, nuts and casters are). The server asks the page with a
     `capture` event and the page posts the shots back. If no page answers within 25 s (tab
     closed, API use), the review uses the server's four-view render instead.
   - what earlier rounds found, applied and rejected, so it doesn't undo its own fixes or retry
     one that failed

   It also gets the results of the exact checks, which must all pass before it can sign off.
   It answers with re-mates and part edits. Edits go back to the part's agent with its
   original brief; an edit that gives the part's new port frames is built to them, one that
   doesn't lets the frames follow the build (the instruction may move features). Edits are
   applied before re-mates, since a re-mate may need a port an edit adds. A re-mate is kept only
   if the measured checks don't get worse. The loop ends when:
   - the reviewer says the assembly meets the request
   - it has problems it can't fix
   - two rounds in a row change nothing
   - or after `CAD_REVIEW_MAX_ROUNDS` rounds

   The conversation then gets one summary: what was fixed and anything still open. A snapshot is
   taken before the first fix.

### Changing an existing assembly

The design intent is stored, so the whole assembly can be re-planned, re-solved and reviewed at any
time:
- each copy's mate
- each part's plan spec and id: role, features, ports, checks, interfaces and envelope
- the assembly's shared dimensions

**Prompts on a non-empty assembly are change plans.** The planner gets every existing part (its
id, size, parameters, ports and mates) plus the viewport screenshot. It answers with:
- `update`: instructions for the agents of existing parts, including neighbours that must follow
  the change, and any new ports, features or checks
- `parts`: genuinely new parts, which may mate to existing ones
- `remove`: parts the change makes obsolete (they go to the trash)
- `placements`: re-mates of existing copies
- changed shared dimensions

**Edits ripple.** After a part is edited, the mates are solved again (parts mated to it follow its
new ports) and the review loop runs over the whole assembly, so it can update neighbours that no
longer fit.

**Manual moves win.** Dragging or typing a copy's position clears its mate (the inspector shows
"Placed by hand"), and the solver leaves it where it was put.

### Ports and mates

Part code declares its connection points with `PORT(name, origin, axis, ref=None)`:
- `origin` is a point on the contact surface
- `axis` is the outward normal of that face (pointing away from the part's material)
- `ref` optionally fixes the rotation about the axis

The plan lists the ports each part needs, each with its frame in the part's own coordinates
(origin, axis, optional ref). Every build checks each port:
- it must be within 0.2 mm and 2° of the planned frame
- its origin must be on the part's surface, or at the centre of a hole or shaft end in that face's
  plane
- its axis must point out of the material

An agent can't hand in a part with a missing or wrong port; it's told exactly which one and why.
Changes made outside the plan (a prompt edit of one part, parameters, hand-written code, a revert)
make the build the truth: the part's planned frames follow it, and the review brings the
neighbours to it.

Each copy has one mate: `{port, to, to_port, gap, angle}`, and may list further contacts in
`also` (same shape), which are checked but don't place the part. The solver:
1. turns the part so the two axes face each other
2. lines up `ref` if both ports have one
3. puts the origins together, `gap` mm apart along the target's axis (negative pushes it in, e.g.
   a wheel slid onto a shaft)
4. turns it `angle` degrees about the axis

The ground is a port at the origin facing +Z. Plans that still use the older face attachments fall
back to bounding-box placement.

### Fasteners

Every bolted joint gets standard hardware as separate parts: socket head screws (ISO 4762), hex
nuts (ISO 4032), washers (ISO 7089) and hex standoffs, in M2–M6. They're built from fixed templates
in `services/cad/fasteners.py`, not by an agent, and come with ports:
- screw: `seat` (under the head, axis along the shank) and `tip`
- nut and washer: `seat` and `top`
- standoff: `bottom` and `top`

Screws are derived by the assembler from the architect's joints (see above), one fastener part per
size and length with a copy mated to each head port; nuts likewise. Standoffs and washers are placed
by the architect. Clearance hole sizes are part of the architect's instructions. Threads aren't modelled: a screw in
a clearance hole, or threaded into a nut or standoff (bored to the nominal diameter), doesn't
register as a collision.

### Catalog

Bought components are templates in `services/cad/catalog.py`, with datasheet dimensions and exact
ports: SG90, MG996R and DS3218 servos, the 25T round horn and the SG90 arm horn, the N20 gear motor,
the NEMA 17 stepper, and 608, 625 and 6900 bearings. Ports carry flags the assembler uses: `tapped`
(size and depth a screw threads into) and `joint: revolute` (a mate here turns about the axis).
The architect sees the catalog with every port and picks by id; the part is built from the template
and never redesigned. Adding a component means adding its dimensions and a builder there.

### Exact checks

After placement the geometry worker measures every pair of placed parts whose boxes come within
1 mm of each other:
- the volume they share, from a real boolean intersection, with its centre and bounding box
- their minimum distance

From those it reports:
- collisions (shared volume over 1 mm³) and where they are
- mates whose parts are more than 0.3 mm apart (a port that isn't on its surface)
- `also` contacts that don't close
- parts that touch nothing
- unresolvable mates (missing ports, unknown targets)

The review must clear all of these before it can be satisfied, and a re-mate that makes them worse
is rejected. A typical assembly is checked in a fraction of a second.

Models are poor at coordinate arithmetic, so asking them for positions gave floating or
overlapping parts. Attachments are something they get right, and the arithmetic is exact.

**Concurrency and limits.** All agents run on one event loop:
- Bedrock calls run in threads (`asyncio.to_thread`).
- Geometry jobs are awaited over pipes or HTTP.
- Throttling (`ThrottlingException`) is retried with exponential backoff, because several agents
  sending renders can exceed an account's per-minute token quota.

On the test account a 4-part robot chassis took about 5 minutes, mostly waiting out
throttling. With a higher Bedrock quota, `CAD_PARALLEL_PARTS` can go up.

Edits send the current code, the requested change and, if one was picked, the
selected face (its type, centre, normal and area) so the model can select it
with `NearestToPointSelector`.

**The agent sees what you see.** When you send a prompt, the page captures the 3D viewport (JPEG,
up to 1280 px wide), with your camera angle, the tinted selection, the orange face highlight and
the port arrows. An edit's part agent starts with that screenshot plus a four-view render of the
part as it is before the change. A prompt that adds parts to an existing assembly gives the
planner the screenshot too. Review redesigns get the before render as well.

## Geometry execution

```
backend (FastAPI) ──HTTP──▶ cad-worker (same image, sandboxed)
     │                            └─ pool of warm runner processes (CadQuery imported once)
     └──────── shared volume /data/cad ────────┘
```

- **Warm workers.** Importing CadQuery takes about 4 s and building a typical
  part takes about 0.2 s, so runners stay alive between jobs. A job that times
  out kills its runner, which is replaced; runners are recycled after
  `CAD_WORKER_MAX_JOBS` jobs.
- **Never blocks the API.** Jobs are awaited asynchronously.
- **Sandbox.** Code written by the model runs only in `cad-worker`, which has:
  - no Docker socket
  - no secrets
  - a read-only filesystem
  - no Linux capabilities
  - capped memory, CPU and process count
  - an internal-only network, so no outbound access
- **Local development.** Without `CAD_WORKER_URL`, the backend runs the same
  pool in-process.
- **Content-addressed storage.** A build's key is the hash of its code,
  parameters, files and the runner version. Identical builds are served from
  `objects/<key>/` (`part.step`, `part.stl`, `mesh.json`, `meta.json`).
  Exports are written to `exports/` and deleted after a day.

Measured locally, under x86 emulation:

| | Before | Now |
|---|---|---|
| One part build | 4.5 s, blocking the API | 0.6 s |
| 4 parts | sequential | 0.8 s on 2 workers |
| Rebuilding an existing version | full rerun | ~2 ms (cached) |

## Physics sandbox

The atom button in the viewport toolbar turns the assembly into a rigid-body simulation in the
browser (Rapier, Z up, gravity 9.81 m/s²):
- every copy is a convex-hull collider with the density of plastic
- copies joined by fixed mates are one rigid body (a plate with its standoffs and screws moves as
  a piece); a body with a copy mated to the ground is static
- a revolute mate is a hinge about the mated port's axis (a horn on a servo shaft, a wheel on an
  axle), so a chain of links swings when any link is moved
- copies placed by hand are free bodies: they fall, rest on the ground and on each other, and get
  pushed

Drag a part to drive it; everything joined to it reacts. "Keep poses" writes the simulated
positions and rotations to the assembly (mates stay, so the next generation re-solves them);
"Reset" puts everything back. The world is built from the placements at the moment physics is
switched on; edits made while it runs don't reach it.

Collision shapes are convex pieces of each part (CoACD decomposition, computed by the geometry
worker on first request and cached as `hulls.json` next to the part's files), so bores, pockets
and gaps are kept; a part the worker can't decompose falls back to one convex hull. Pairs of
bodies that already overlap when physics starts (a defect the review didn't fix) are left alone
instead of being flung apart, and the floor sits at the assembly's lowest point.

### Keeping parts out of each other

Overlaps are fought at every stage, not only in the review:
- **On paper.** With the plan's envelopes placed by its frames, two envelopes that aren't mated to
  each other and sit mostly inside one another are a plan problem, fed back to the detailers.
- **In the brief.** Each part agent gets its neighbours as boxes in its own coordinates ("servo#1
  occupies x -27..27, y -10..10, z 3..46; you meet it at seat → bottom"), so it designs around them.
- **In the build loop.** Every build is placed as the plan places it and intersected exactly with
  the neighbours (built ones by their solid, unbuilt ones by their envelope, except envelopes of
  parts it is mated to). Overlaps come back in the part's frame with the shared box, and `finish`
  is refused while any remain. A build larger than its planned envelope (by more than 2 mm + 5 %)
  is refused too: the other parts are placed around that envelope.
- **In the automatic repair.** A screw through solid gets a clearance hole; any other collision
  is charged to the custom part (between two custom parts, the one further over its envelope,
  else the child in the mate tree), which is told the overlap box in its own frame to cut away.
- **In the review.** Whatever is left reaches the reviewer with the collision locations.

## History

| What | How |
|---|---|
| **Part versions** | Every change to a part (generation, prompt edit, review fix, parameters, code) is a new immutable version. Inspector → History lists them; any one can be made current again. |
| **Undo / redo** | Assembly edits (move, rotate, colour, visibility, names, adding or removing copies) are undoable with ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y) or the toolbar buttons. Typing in a field or dragging the colour picker counts as one step. The stack is per session; it resets when the server replaces the assembly (generation, snapshot restore). |
| **Snapshots** | The assembly plus every part's current version. Saved by hand (History tab → name → Save) and automatically before each generation, before review fixes and before a restore. Restoring brings back positions and part versions, and un-deletes parts it needs; the automatic "Before restoring …" snapshot makes a restore itself reversible. The last 50 are kept. |
| **Trash** | Deleting a part only marks it deleted and remembers its copies. History → Deleted parts restores it with its copies where they were. Parts are removed permanently after 30 days. |
| **Conversation** | The assistant conversation is saved per project (prompts, what was built, review findings, errors) and reloaded when the project opens. Messages from the old CAD chat are carried over once. |

## Exports

| Format | For |
|---|---|
| STEP | CAD tools (Fusion, SolidWorks, FreeCAD, Onshape). Keeps part names, colours and placements. |
| STL (merged), 3MF | Slicers |
| STL per part (zip) | Printing parts separately |
| GLB | Web, AR, Blender |
| URDF package (zip) | ROS 2 and simulators. One link per instance with STL meshes (in metres), mass and inertia computed from the solid (default density 1200 kg/m³). The mate tree is the kinematic tree: each link hangs off the link it is mated to (`base_link` for the ground), as a fixed joint or a revolute joint about the mate axis. |

## API

All routes are under `/api/cad` and require the project owner's token.

| Method | Route | |
|---|---|---|
| GET | `/{project}` | Parts (current versions) and assembly |
| POST | `/{project}/generate` | Prompt → parts (SSE) |
| POST | `/{project}/parts/{part}/edit` | Prompt edit, optional `face` (SSE) |
| POST | `/{project}/parts/{part}/params` | New version from parameter values |
| PUT | `/{project}/parts/{part}/code` | New version from code |
| GET | `/{project}/parts/{part}/versions` | Version history |
| POST | `/{project}/parts/{part}/revert` | Make an older version current |
| POST | `/{project}/parts/{part}/duplicate` | Copy as a new part |
| PATCH / DELETE | `/{project}/parts/{part}` | Rename or recolour / move to the trash |
| PUT | `/{project}/assembly` | Save instances and name |
| GET / POST | `/{project}/snapshots` | List / save a snapshot (`{label}`) |
| POST | `/{project}/snapshots/{id}/restore` | Restore one (the current state is snapshotted first) |
| DELETE | `/{project}/snapshots/{id}` | Delete a snapshot |
| GET | `/{project}/trash` | Deleted parts |
| POST | `/{project}/parts/{part}/restore` | Restore a deleted part with its copies |
| GET / DELETE | `/{project}/messages` | The saved conversation / clear it |
| POST | `/{project}/import` | Multipart upload → new part and instance |
| POST | `/{project}/export` | Download the assembly in a format |
| POST | `/{project}/captures/{request}` | The viewer's screenshots for a review round (`{images: [{view, data}]}`) |
| GET | `/files/{key}/{name}` | A built part's `mesh.json`, `part.step` or `part.stl` |

## Configuration

| Setting | Default | |
|---|---|---|
| `CAD_WORKER_URL` | unset (local pool) | Set to `http://cad-worker:8100` by docker-compose |
| `CAD_STORAGE_DIR` | `/tmp/cubot-cad` | `/data/cad` (shared volume) in docker-compose |
| `CAD_MODEL_ID` | `us.anthropic.claude-opus-4-6-v1` | Architect and reviewer |
| `CAD_PLAN_THINK` | 6000 | Extended-thinking budget for the architect (0 disables) |
| `CAD_REPAIR_ROUNDS` | 2 | Automatic repair rounds before the reviewer (0 disables) |
| `CAD_FAST_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | First choice for quick one-off calls |
| `CAD_AGENT_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Part agents. They make the most calls (with renders), so a lighter model keeps daily token quotas in reach. |
| `CAD_PARALLEL_PARTS` | 3 | Part agents working at once |
| `CAD_AGENT_STEPS` | 8 | Model turns per part agent |
| `CAD_REVIEW_MAX_ROUNDS` | 5 | Cap on review rounds; the review stops earlier once it's satisfied (0 turns it off) |
| `CAD_WORKERS` | 2 (1 in compose) | Runners per worker service; each uses about 300 MB |
| `CAD_JOB_TIMEOUT` | 60 s | Per job |
| `CAD_MAX_UPLOAD_MB` | 50 | Import size limit; nginx allows 50 MB |

If the account can't use a model (`AccessDenied` and similar), or its daily token quota is used
up, the next one in the chain is used from then on: `CAD_FAST_MODEL_ID` → `CAD_MODEL_ID` →
`BEDROCK_MODEL_ID`. Part agents and the review's render need an Anthropic model. Newer models can be switched on by setting these once the
account has access to them.

## Not done yet

- **Mates.** Instances are placed by hand with snapping; there are no
  face-to-face or axis constraints, and URDF joints are all fixed.
- **Garbage collection.** Unused builds in `objects/` are never removed, only
  exports are.
- **Storage.** Files live on a local volume; S3 storage would fit the
  content-addressed layout.
- **Daily quotas.** A generation with fasteners and several review rounds can use a large share of an
  account's daily Bedrock token quota. When it runs out, the run stops with a clear message
  instead of retrying.
- **Large meshes.** Meshes over 40,000 triangles are rejected because they are
  sewn into a B-rep.
