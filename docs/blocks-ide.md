# CuBot Blocks — visual automation IDE

CuBot Blocks is a flow-based programming environment for a robot workcell. You
build a program from blocks, run it on a simulated cell (a 6-axis arm,
conveyor, vision camera, sorting bins, pallet and CNC machine), and then take
the same program to real hardware.

The previous version was a demo: if/while blocks did nothing, every user
shared one global arm state on the backend, and programs could not leave the
browser. This version is built around a single, well-defined program model.

## What's in the box

| Area | What it does |
| --- | --- |
| **Block language** | 27 blocks in 7 categories: flow control, motion, gripper & pick, I/O & conveyor, sensing & vision, data & logic, connectivity. |
| **Canvas** | Blocks show an icon, their key settings (editable right on the block), live run state and problems. Branch outputs are labelled. **Tidy** arranges the program: sequences top to bottom, branches side by side, loop bodies indented. |
| **Expressions** | Number and condition fields accept expressions (`count * 70`, `part_color == "red" and not part_defect`, `sin(360 / sides * i)`). The parser is sandboxed — there is no `eval`. |
| **Compiler & Problems panel** | The graph is checked before it runs: missing Start, unconnected blocks, cycles that are not explicit loops, unknown variables, poses that were never taught, expression syntax errors. Clicking a problem jumps to the block. |
| **Simulator** | Workcell physics in simulated time with 0.5×–10× speed, pause, step-by-step execution (F10), emergency stop, joint-limit and reachability checks, and a safety interlock on the machine zone. |
| **Teach pendant** | Jog the tool in mm, teach named poses, and move to them. Blocks refer to poses by name, so re-teaching one pose updates every block that uses it. |
| **Environment editor** | Build your own cell: add conveyors, bins, pallets, a CNC machine, parts trays, tables, fences, a stack light and your own 3D models (GLB, glTF, STL, OBJ); drag them in the 3D view or type their position, rotation and size. Presets, a personal library, and JSON import/export. |
| **Cell & I/O panel** | Production KPIs (picks, placed, parts/min, bin and pallet counts), live digital I/O, joint readouts with limit warnings, and scene setup (part colours, defect rate, feed limit, tool trail). |
| **Sensors** | Rendered camera feeds with OpenCV-style colour detection you can tune live, plus readings for photo-eyes, gripper, joints and I/O. |
| **Console** | Run log, problems, live variables, and MQTT telemetry. |
| **Export** | Standalone Python (IK, serial controller, MQTT via paho, OpenCV colour vision), Arduino controller firmware, and a JSON project file. |
| **Hardware mode** | *Connect arm* uses Web Serial to send every motion, gripper and output command to a real controller, and waits for the controller to acknowledge each one. |
| **Templates** | 10 runnable use cases: 5 industrial, 5 educational (below). |

## Architecture

```
graph (React Flow) ──compile()──► structured program (AST) ──► Interpreter ──► World (simulation)
                                        │                                         │
                                        ├──► generatePython()                     └──► SerialLink (optional)
                                        └──► Problems panel
```

All of it lives in `frontend/lib/blocks/`:

| File | Responsibility |
| --- | --- |
| `registry.ts` | Block definitions: fields, ports, palette, summaries. Single source of truth. |
| `expression.ts` | Expression tokenizer, parser, evaluator, and Python translation. |
| `compiler.ts` | Graph → AST. Resolves if/else merge points, loop bodies, and validation. |
| `interpreter.ts` | Executes the AST against the world; step, stop, and fault handling. |
| `layout.ts` | Cell layout as data: station kinds, geometry, owned poses, validation, environment presets. |
| `workcell.ts` | Simulated cell: motion profiles, conveyor queueing, grasping, collisions, machine, I/O — all driven by the layout. |
| `kinematics.ts` | Forward and analytic inverse kinematics (tool pointing down) plus joint limits. The 3D model uses the same chain. |
| `codegen.ts` | Python program and Arduino firmware generators, and the serial protocol. |
| `serial.ts` | Web Serial link with one command in flight at a time and an ack for each. |
| `templates.ts` | Use-case programs written in a compact nested form, laid out automatically on the canvas. |

The simulation runs entirely in the browser, so each user gets their own cell.
The backend only stores programs: `/api/blocks/programs` now also persists
`poses` and `settings` (scene and environment layout). Programs saved by the old editor still load —
`ifelse`, `delay` (in ms) and `millis` are migrated automatically.

### Flow semantics

* Execution starts at **Start** and follows connections.
* **If / else**: the true and false branches both continue at the first block they share.
* **Repeat / While**: the *loop* output runs until its branch ends (or links back to the loop block). Execution then continues from *done*.
* Any other cycle is an error. Loops must be explicit, which keeps every program exportable to structured code.

### Serial protocol (controller side)

```
J a1 a2 a3 a4 a5 a6 secs   → ok        joint move, smooth-step interpolated
G 0|1                      → ok        gripper open / close
O ch 0|1                   → ok        digital output
I ch                       → ok 0|1    digital input
```

The browser's hardware mode, the exported Python program and the generated
firmware all speak this protocol. Linear moves are sent as a stream of joint
waypoints, so the controller never has to solve IK.

### I/O map

| Channel | Meaning |
| --- | --- |
| DO0 | Conveyor run |
| DO1 | Machine cycle start (rising edge) |
| DO2 / DO3 | Stack light green / red (red is set automatically on any fault) |
| DI0 | Part at pick point (photo-eye at the end stop) |
| DI1 | Machine cycle done |
| DI2 | Machine zone clear (robot outside x < −400 mm) |
| DI3 | Operator button (hold it in the Cell panel) |

## Building your own environment

Open the **Environment** tab (editing is locked while a program runs). Switch
the 3D view to **Top** for the easiest placement.

| Station | What it does | Pose it owns |
| --- | --- | --- |
| Conveyor | Feeds parts to an end stop with a photo-eye and a vision camera on a pole (its cone shows the field of view; the pole and head are solid). DO0 runs every conveyor; DI0 is on when any pick point holds a part. Length and camera side are adjustable; keep the camera on the side away from the robot. | `PICK` (end stop) |
| Bin | Open container; parts inside are counted in the Cell panel. Size and colour adjustable. | `BIN_<NAME>` |
| Pallet | Flat place surface; its pose is the first corner slot for the Pallet slot block. | `PALLET` |
| CNC machine (one per cell) | DO1 starts a cycle, DI1 reports done, DI2 is off while the tool is in front of the fixture. Cycle time adjustable. | `MACHINE` (fixture) |
| Parts tray | Grid of parts (rows × columns, 70 mm pitch) refilled on every reset. Picking without a conveyor. | `TRAY` (first slot) |
| Table | Work surface you can place parts on. | `TABLE` (centre of top) |
| Fence | Obstacle or safety guard. | — |
| Stack light (one per cell) | Shows DO2 / DO3. | — |

* **Move:** drag a station on the floor (10 mm snap), or type X / Z. Arrow keys nudge 10 mm (Shift: 50 mm).
* **Rotate:** R / Shift+R in 15° steps, the rotate buttons, or type the angle. *Face the robot* points a conveyor or machine at the robot.
* **Remove:** Del in the 3D view or the trash button (with Undo).
* **Poses follow stations.** Moving, rotating or resizing a station carries its pose along, including any offset you re-taught. *Reset pose to station* puts it back at the reference point.
* **Layout checks** flag stations the robot cannot reach (or approach from above), stations overlapping each other or the robot base, and stations off the floor. The green ring shows the robot's reach.
* **Collisions:** the gripper, a part it holds, or any arm link faults the program if it goes into a station (including bin walls), another part, or the floor. Joint moves swing in an arc, so raise the approach height when a table sits between two stations.
* **Environments:** *Load an environment…* offers presets (full production cell, two-lane sorting, palletizing station, classroom table, empty floor) and your saved ones. *Save* stores the current cell in this browser; *Export* / *Import* move it between computers. The environment is also saved with the program and its project file.

The Vision inspect block reads the part at a conveyor pick point, or the part in the gripper when no part is waiting (wrist camera), so tray cells can sort by colour too.

## Adding your own equipment (3D models)

**Environment → Import 3D model** adds a custom station from a 3D file. It behaves like a table: its bounding box is the collision shape (switch **Solid** off for decoration), parts can be placed on top, and it gets a pose on its top surface named after the file. Move, rotate and save it like any other station; the file is embedded in the environment, so programs and exported environments carry it with them.

| Format | Use it for | Notes |
| --- | --- | --- |
| **.glb** (recommended) | Models from Blender, Onshape, SolidWorks (via exporters), Sketchfab, vendor sites | One file with geometry, colours and textures. glTF is metres, Y-up by spec. |
| **.gltf** | Same as .glb | Only if self-contained (buffers and textures embedded). If it comes with separate `.bin` or image files, export a `.glb` instead. |
| **.stl** | CAD parts and fixtures (FreeCAD, Fusion 360, SolidWorks, Inventor) | Geometry only; pick a colour in the panel. Usually millimetres and Z-up. |
| **.obj** | Older tools and scans | Geometry only (`.mtl` materials are ignored). |

* **Size limit:** 5 MB per model. Keep models under ~100 k triangles; decimate scans and dense CAD meshes first (Blender: Decimate modifier; most CAD tools have a coarse STL export).
* **Units and orientation:** the panel guesses (glTF = m, Y-up; STL/OBJ = mm, Z-up). If a model is the wrong size, change **File units**; if it lies on its side, toggle **Z-up file**; use **Scale** for anything else. The measured size is shown in the panel.
* **STEP / IGES / native CAD files** are not read in the browser. Export STL (for a single part) or glTF/GLB (for assemblies with colours) from your CAD tool, or convert with FreeCAD or Blender.
* **Try it:** `docs/samples/workbench_mm_zup.stl` (800 × 500 × 740 mm workbench, mm, Z-up) and `docs/samples/crate_mm.obj` (300 mm crate).
* **Robot vendor models:** cell components from vendor libraries (grippers, conveyors, fences) usually come as STEP — convert as above.

## Sensors and vision

Cameras are simulated sensors, the way MuJoCo does it: each one renders a real image of the scene from where it is mounted, and **Vision inspect** runs colour detection on that image. Placement, field of view, lighting and occlusion all matter — a part outside the view, or hidden behind the arm, reads `none`.

| Camera | Where | Used by Vision inspect |
| --- | --- | --- |
| Conveyor camera | On a pole beside each conveyor, looking at its pick point | `auto` when a part waits there, or by the conveyor's name |
| Wrist camera | Beside the gripper, looking down between the fingers | `auto` while holding a part, or `wrist` |

**Detection** mirrors OpenCV, and the exported Python runs the identical pipeline with `cv2`:

1. Crop the centre of the 160×120 image (ROI).
2. Convert to HSV (H 0–180, S/V 0–255) and `inRange` each colour class; red wraps around H = 0.
3. `countNonZero` per class: the largest class covering at least *min area* of the ROI wins.
4. Centroid (moments) and bounding box of the winning mask.
5. Defect: dark pixels (V below the threshold) enclosed by the part's mask — the mark on a defective part.

Vision inspect sets `part_color`, `part_defect`, `part_ok`, `part_area` (% of the ROI) and `part_cx` / `part_cy` (centroid, −1…1), so programs can also correct a pick position from the image.

**Sensors tab.** Live feed of each camera with the mask, ROI, bounding box and centroid drawn on top (hover a pixel to read its HSV values), *Inspect now*, the last inspection, the colour classes and thresholds (saved with the program and exported to the Python `VISION` config), and live readings of the other sensors: photo-eyes, gripper, TCP, joints, machine and digital I/O.

**Defaults.** Red H 170→8, yellow 18–35, green 40–85, blue 95–130 (S ≥ 90). The gap at H ≈ 11 keeps the robot's orange joints from reading as parts. Without a 3D view (headless tests) inspections fall back to the simulation state and are labelled *ground truth* in the log.

## Physics model

The simulator aims for believable behaviour at interactive speed, not a full rigid-body engine:

* **Gravity:** a released part falls freely (g = 9.81 m/s²) to whatever is below it; a 300 mm drop takes 0.25 s.
* **Stability:** a part stays where it lands only if its centre of mass is over its support — one part, several parts bridged at the same height, or a station surface. Otherwise it tips off that edge. Parts left unsupported (the part below was picked) fall too.
* **Bins:** bin poses release just above the rim. Dropped parts settle into the lowest free spot, so bins fill layer by layer instead of as a tower.
* **Gripping:** a part is gripped only if it sits between the fingers (centred within 18 mm, fingertips at its middle). It turns with the tool (J1 and J6).
* **Gripper fingers:** fully open, the fingers clear a 50 mm part by 8 mm a side, and they are collision-checked against parts and stations. They cannot fit between parts queued nose to tail, so they must close across the belt, and a tool turned diagonally to a cube hits its corners.
* **Tool angle:** a pose can carry a tool angle `Rz` (the direction the fingers close; editable in the Poses tab, captured when you teach). Without one, the tool keeps its current angle in the cell. Linear moves hold the angle fixed and turn smoothly to a new one, like a real robot. A conveyor's PICK pose comes with the angle across its belt and turns with the conveyor.
* **Conveyor:** an accumulating belt; parts queue touching each other, and a part being lifted out of the lane blocks the queue until it clears.
* **Timing:** when a move or wait finishes, the clock stops at that instant before the next block starts, so cycle times are the same at any simulation speed or frame rate.

Not modelled: part rotation while tumbling, friction-driven sliding, and pushing parts with the arm.

## Use cases — industry

Each of these is a template you can load from **Templates → Industry**.

### 1. Conveyor pick & place — packaging, food & beverage
An accumulating conveyor brings parts to an end stop. The robot waits for the
photo-eye (DI0), picks with an approach/retract move, and loads a tote. A
counter and the green stack light report progress.
*Real-world mapping:* case packing, tray loading, end-of-line transfer.
*Shows:* sensor-triggered picking, approach heights, cycle counting.

### 2. Vision quality sorting — inspection, recycling
The camera inspects every part. Defects go to the reject bin, and good parts
are sorted by colour. Counts are published to `factory/cell1/quality` over
MQTT after every part.
*Real-world mapping:* QC reject lanes, colour/grade sorting in recycling or
food processing.
*Shows:* vision results as variables, nested decisions (exported as
`if/elif/else`), telemetry.

### 3. Palletizing 3 × 3 × 2 — logistics, warehousing
One taught corner pose plus a **Pallet slot** block computes all 18 place
positions. To switch to a new pallet pattern, you edit six numbers instead of
re-teaching 18 points.
*Real-world mapping:* end-of-line palletizing of boxes, bags and crates.
*Shows:* frame + offset programming, computed patterns.

### 4. CNC machine tending — metalworking, discrete manufacturing
The robot loads a raw part into the machine and leaves the machine zone. It
then confirms the zone-clear input (DI2), pulses cycle start (DO1), waits for
cycle done (DI1) with a timeout, and unloads the finished part, which turns
metallic. If the robot enters the zone during a cycle, the safety interlock
faults the program.
*Real-world mapping:* lathe, mill and injection-moulding tending.
*Shows:* I/O handshakes, interlocks, timeouts that raise alarms.

### 5. Production cell with OEE telemetry — Industry 4.0
A continuous cell measures the cycle time of each part with `time`, streams
part, cycle time, quality and defect count to MQTT, and drives the stack
light. After 3 defects it raises a quality alarm and stops.
*Real-world mapping:* the data layer behind OEE dashboards (Grafana, MES,
historian).
*Shows:* KPI measurement, alarms as process guards.

### More industrial ideas the blocks support today
* **Kitting** — pick different colours into fixed slots of a tray using `pallet` offsets and a colour → slot `if` chain.
* **Line balancing study** — change belt speed and sim speed, and watch parts/min and the queue on the conveyor to find the bottleneck.
* **Commissioning dry runs** — run the program in simulation, export Python, and use `--dry-run` to review every controller command before it reaches a real cell.
* **Operator-paced station** — `Wait for input` on DI3 (operator button) before each cycle.

## Use cases — education

Load them from **Templates → Education**. Each template has a suggested
classroom prompt.

| Template | Level | Concepts | Classroom prompt |
| --- | --- | --- | --- |
| **Hello, robot!** | Ages 10+ | Sequencing, 3D coordinates, step mode | Predict where the arm goes before you press Run, then change one number and predict again. |
| **Draw a polygon** | Ages 12+ | Loops, counter variables, sin/cos | Set `sides` to 3, 6 or 36. Why does the shape always close? |
| **Sensors & decisions** | Ages 12+ | Waiting on sensors, if/else, comparisons | Add a rule for yellow parts, then turn on yellow in Scene settings. |
| **Build a tower** | Ages 12+ | Variables, offsets, string templates | Rewrite it with While so it stops at 200 mm. |
| **Desk sorting — your own cell** | Ages 10+ | Building a cell, grid offsets, wrist-camera vision | Drag the tray or a bin somewhere else and run again, then add a green bin and a rule for it. |

### Course outline built on the templates (7 sessions)
1. **Sequencing** — Hello, robot!, using Step mode and the tool trail.
2. **Coordinates & poses** — teach your own poses with the teach pendant, and use Move to pose.
3. **Loops** — Draw a polygon, then a spiral (change `length` inside the loop).
4. **Sensors & logic** — Sensors & decisions, then extend it to colour sorting.
5. **Variables & data** — Build a tower, then log and publish counts.
6. **Design a cell** — start from *Empty floor*, build a station for a task you choose, and program it.
7. **From simulation to reality** — export Python, run `--dry-run`, then flash the firmware to a desktop servo arm and use *Connect arm*.

### University / vocational extensions
* **Kinematics lab** — compare `Move joint` against `Move to XYZ`, read joint values in the Cell panel, and check them with the FK/IK code in the exported Python.
* **Industrial automation course** — machine tending and OEE templates for I/O handshakes, interlocks, alarms and MQTT/IIoT integration.
* **Computer vision** — replace `inspect_part()` in the exported Python with a trained classifier, keeping the robot logic unchanged.

## Taking a program to hardware

1. Build a 6-servo desktop arm (or adapt the pin and offset tables) and flash **Export → Arduino firmware**.
2. Calibrate `SERVO_OFFSET` and `SERVO_DIR` so that the arm matches the simulator at HOME.
3. In Chrome or Edge, click **Connect arm**. The simulator now waits for the real arm on every move.
4. To run without a browser, use `python program.py --port /dev/ttyUSB0 [--mqtt broker]`.

## Known limits

* The IK assumes the tool points straight down, which covers pick, place and drawing. Tilted tool orientations are not supported.
* Collision checking uses simplified shapes: station boxes, cube parts, and spheres along the arm links.
* The robot base is fixed at the origin; there is one CNC machine and one stack light per cell, and all conveyors share DO0 / DI0.
* In hardware mode, inputs (DI0–DI3) still come from the simulation. The exported Python reads them from the controller.
* The simulation keeps running in background tabs, but at reduced speed.
