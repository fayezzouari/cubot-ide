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
request ─▶ architect ─▶ part agents (swarm, in parallel) ─▶ placement ─▶ review ─▶ fixes
            granular      build → measure → look → fix        exact,        render +    back to the
            plan          until the part meets its checks     from sizes    measurements part agents
```

1. **Architect (granular plan).** One call to `CAD_MODEL_ID` produces:
   - an **interfaces** table: every dimension parts must agree on (shaft and bore diameters,
     hole patterns, thicknesses that set heights), with one value each
   - for each part: its role, expected envelope, dimensioned features, acceptance checks, the
     interfaces it uses, and how each copy **attaches**: a rotation, a target part or the
     ground, a side (`top`, `bottom`, `left`, `right`, `front`, `back`), an offset along that
     face and an optional gap

   Part engineers only see their own part plus the interfaces table, so nothing shared is
   allowed to live only in one part's text.
2. **Part agents (swarm).** Each part gets its own tool-using agent, run concurrently with
   `asyncio` (`CAD_PARALLEL_PARTS` at a time, `CAD_AGENT_STEPS` turns each). Its tools:
   - `build_part(code)`: returns the measured geometry or the error
   - `view_part()`: a four-view render of its part
   - `finish(notes)`

   Agents must look at their render before finishing. The best build is kept if an agent runs
   out of turns. Parts that fail (for example on rate limits) are retried one at a time.
   Without a tool-capable model, parts fall back to one-shot code with error feedback.
3. **Placement.** Using each part's real bounding box after rotation, the backend puts it
   against the chosen face of its target: touching it, outside it, centred plus the offset.
   Then the assembly is lowered so its lowest point rests on z = 0.
4. **Review (reflection).** `CAD_REVIEW_ROUNDS` passes. The reviewer gets:
   - the request and the plan
   - the measured world boxes
   - automatic checks (overlaps, parts touching nothing, uneven footing)
   - a four-view render of the whole assembly

   It answers with re-attachments and part edits. Edits go back to the part's agent with its
   original brief. A re-attachment is kept only if the measured checks don't get worse, since
   one early run showed a review moving the wheels into the plate.

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
| URDF package (zip) | ROS 2 and simulators. One link per instance with STL meshes (in metres), mass and inertia computed from the solid (default density 1200 kg/m³), fixed joints to `base_link`. |

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
| GET | `/files/{key}/{name}` | A built part's `mesh.json`, `part.step` or `part.stl` |

## Configuration

| Setting | Default | |
|---|---|---|
| `CAD_WORKER_URL` | unset (local pool) | Set to `http://cad-worker:8100` by docker-compose |
| `CAD_STORAGE_DIR` | `/tmp/cubot-cad` | `/data/cad` (shared volume) in docker-compose |
| `CAD_MODEL_ID` | `us.anthropic.claude-opus-4-6-v1` | Architect, part agents and reviewer |
| `CAD_FAST_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | First choice for quick one-off calls |
| `CAD_PARALLEL_PARTS` | 3 | Part agents working at once |
| `CAD_AGENT_STEPS` | 8 | Model turns per part agent |
| `CAD_REVIEW_ROUNDS` | 1 | Review passes after generation (0 turns it off) |
| `CAD_WORKERS` | 2 (1 in compose) | Runners per worker service; each uses about 300 MB |
| `CAD_JOB_TIMEOUT` | 60 s | Per job |
| `CAD_MAX_UPLOAD_MB` | 50 | Import size limit; nginx allows 50 MB |

If the account can't use a model (`AccessDenied` and similar), the next one in
the chain is used from then on: `CAD_FAST_MODEL_ID` → `CAD_MODEL_ID` →
`BEDROCK_MODEL_ID`. Part agents and the review's render need an Anthropic model. Newer models can be switched on by setting these once the
account has access to them.

## Not done yet

- **Mates.** Instances are placed by hand with snapping; there are no
  face-to-face or axis constraints, and URDF joints are all fixed.
- **Garbage collection.** Unused builds in `objects/` are never removed, only
  exports are.
- **Storage.** Files live on a local volume; S3 storage would fit the
  content-addressed layout.
- **Large meshes.** Meshes over 40,000 triangles are rejected because they are
  sewn into a B-rep.
