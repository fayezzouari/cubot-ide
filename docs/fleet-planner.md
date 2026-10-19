# Fleet Planner

The Fleet Planner is CuBot's multi-robot planning and coordination workspace.
You draw a warehouse-like environment, place ground robots, drones and tasks in
it, and CuBot plans paths, assigns tasks to vehicles and dispatches the work
over MQTT using the open **VDA 5050** standard. The same workspace drives a
simulated fleet in the browser or real hardware connected with `cubot-sdk`.

A Fleet project is an ordinary CuBot project with the **Fleet** category; it is
created from the dashboard like a Code, Blocks or CAD project and opens at
`/fleet`.

## Concepts

| Thing | What it is |
|---|---|
| **Environment** | A grid of cells, 2D (width × height) or 3D (width × height × depth for altitude layers). It holds the obstacles and a floor preset (`warehouse`, `blueprint`, `concrete`, `hazard`, `sand`). New projects start with a 30 × 30 2D grid. Positions are grid cells: `x` is the column, `y` the row, `z` the altitude layer. |
| **Robot** | A ground vehicle (AGV/AMR) with a position, heading, speed, colour, optional category, a VDA 5050 `serial_number` and `manufacturer`, and a sequence mode. |
| **Drone** | An aerial vehicle. Same idea as a robot, with altitude, and addressed on the `uav/v1/...` topics. |
| **Task** | A place a vehicle has to go: position, priority (0–10), optional deadline, the categories allowed to do it, and whether it is a ground or aerial task. Status is `pending`, `assigned` or `done`. |
| **Category** | A specialisation label such as "picker" or "forklift". A robot with no category is a generalist; a task with no categories accepts anyone; otherwise the robot's category must be one of the task's. |
| **Broker** | The project's MQTT broker record: its `mode` (`simulated` or `live`), whether dispatch is active, the legacy topic prefix (`fleet/<brokerId>`) and the WebSocket URL the browser connects to. |

The canvas renders the same scene in 2D (SVG) or 3D (react-three-fiber),
chosen by the environment's dimension.

## Path planning

The solvers live in `backend/services/fleet/algorithms/` and are pure
functions over the occupancy grid:

| Algorithm | Notes |
|---|---|
| `astar` | Default; optimal on the grid |
| `dijkstra` | Uniform-cost search, same result as A* with more cells explored |
| `theta_star` | Any-angle A*: straight segments across open space |
| `rrt` | Sampling-based; fast, paths are not optimal |
| `rrt_star` | RRT with rewiring; converges towards shorter paths |
| `astar3d` | Used for drone routes through altitude layers |

`planning_service.py` dispatches on the requested algorithm. Before planning it
inflates obstacles by `FLEET_ROBOT_CLEARANCE_CELLS` (1 by default), so the
centre line of a path keeps the robot body clear of walls. Each response
carries the path, its cost and a sample of the explored cells, which the UI
animates. Planning is CPU-bound and runs in a threadpool.

## Task assignment and sequences

Two mechanisms work side by side:

- **Greedy assignment** (`assignment_service.py`,
  `drone_assignment_service.py`, called by `POST /tasks/reassign` and
  `POST /tasks/reassign-drones`). Open tasks are taken in priority order; each
  goes to the closest eligible vehicle, and that vehicle's position moves on to
  the task, so work spreads across the fleet.
- **Sequences** (`sequence_service.py`). Opt-in per vehicle. Starting a
  sequence takes that vehicle's assigned tasks in an explicit order
  (`sequence_index`) and removes the vehicle from greedy assignment until the
  sequence is stopped or finished. The same state machine handles robots and
  drones (`sequence/start`, `advance`, `complete`, `stop`).

The fleet coordinator adds a third, continuous layer: its scheduler
(`coordinator/scheduler.py`) is deadline-aware. High-priority tasks are placed
first, each on the vehicle that reaches it soonest *while still meeting its
deadline*, counting the ETA along that vehicle's queue. If the nearest vehicle
would be late, a farther one that can make it is chosen. A task is never
inserted ahead of higher-priority work, so it can never make that work late.

## Simulated vs live

The broker record's `mode` decides where positions come from:

- **simulated**: the browser's kinematic engine drives the vehicles along their
  planned routes, with separation steering between robots. It also publishes
  each simulated vehicle's VDA 5050 `state` and `visualization`, so the fleet
  coordinator sees the simulated fleet exactly as it would see real vehicles.
- **live**: the app fabricates nothing. The canvas draws only the telemetry
  real vehicles publish.

`dispatch_active` is independent of the mode. Turning it off stops the
coordinator from scheduling and publishing orders for that broker and cancels
orders in flight, without losing any robot or task state.

## Fleet coordinator

The fleet coordinator is a long-running process, separate from the API:
`python -m services.fleet.coordinator`, code in
`backend/services/fleet/coordinator/`. Its manager polls the `fleet_brokers`
collection every `FLEET_POLL_INTERVAL_S` and runs a set of coordinators per
broker, all on one Mosquitto instance with separate topic namespaces:

| Layer | Namespace | What it does |
|---|---|---|
| Fleet coordinator | `fleet/<brokerId>/...` | Position cache, rescheduling on every tick (`FLEET_TICK_INTERVAL_S`) and on priority changes, assignment and status messages |
| VDA 5050 master control | `uagv/v2/<manufacturer>/<serial>/...` | Orders and instant actions for ground vehicles |
| uav master control | `uav/v1/<manufacturer>/<serial>/...` | The aerial counterpart, deliberately simpler |

`FLEET_VDA5050_ENABLED` and `FLEET_UAV_ENABLED` switch the last two on or off.
The coordinator reads and writes the same `fleet_*` collections as the API.

### VDA 5050 topics

```
uagv/v2/<manufacturer>/<serial>/order            coordinator → vehicle
uagv/v2/<manufacturer>/<serial>/instantActions   coordinator → vehicle
uagv/v2/<manufacturer>/<serial>/state            vehicle → coordinator
uagv/v2/<manufacturer>/<serial>/visualization    vehicle → coordinator
uagv/v2/<manufacturer>/<serial>/connection       vehicle → coordinator (MQTT last will)
uagv/v2/<manufacturer>/<serial>/factsheet        vehicle → coordinator
```

- **Connection-gated.** Only vehicles that announced `ONLINE` receive orders.
  A vehicle the coordinator has not seen before gets a `factsheetRequest`; its
  factsheet sets the planning clearance (footprint) and speed.
- **Schedule to order.** On each tick the scheduler assigns open tasks. For each
  robot, the queue becomes A* legs, then a simplified graph of nodes and edges.
  Nodes where a task is reached carry an action (`pick`, `drop` or the
  category name).
- **Base and horizon.** One order per task sequence, with a stable `orderId`.
  As the vehicle advances, the released part of the route (the base,
  `FLEET_HORIZON_BASE_NODES` nodes ahead) slides forward with an
  `orderUpdateId` bump and never moves back. A changed sequence starts a new
  order; work that disappears is withdrawn with a `cancelOrder` instant action.
- **Coordinates.** The app stores grid cells; VDA 5050 uses metres.
  `FLEET_CELL_SIZE_M` and `FLEET_MAP_ORIGIN_X/Y` convert between them. The VDA
  5050 `mapId` is the project id.
- **Identity.** A vehicle's `serialNumber` is the robot's `serial_number`,
  falling back to its id. Telemetry is accepted from any manufacturer (the
  coordinator subscribes with `+` wildcards), but orders are published to the
  manufacturer stored on the robot, which defaults to `FLEET_MANUFACTURER`
  (`cubot`).

### uav topics

Drones use the same layout under `uav/v1/...` (`order`, `instantActions`,
`state`, `visualization`, `connection`; no factsheet). Positions carry an
altitude `z`, and an order is a single full flight (no base/horizon
stitching). Aerial tasks are assigned to drones by the backend; the
coordinator turns an assigned task into an order, sends it once the drone is
`ONLINE`, and marks the task done when the drone reports its delivery action
as `FINISHED`.

## Connecting hardware with cubot-sdk

`sdk/cubot-sdk` is the vehicle side of these protocols. `cubot_sdk.vda5050`
(robots) and `cubot_sdk.uav` (drones) own the MQTT connection, topic strings,
header bookkeeping, heartbeat and last-will message. An integration supplies
two functions:

- `get_state()` returns the real position, battery and errors.
- `on_order(...)` turns a released order into real motion.

```bash
pip install ./sdk/cubot-sdk
python sdk/cubot-sdk/examples/mock_robot.py --host localhost --port 1893 --serial <robot id>
```

To link a fleet:

1. Switch the project's broker to **live** mode in the Fleet workspace.
2. Point the client at the broker's plain MQTT TCP port: `1893` on the host in
   local development (`fleet-broker:1883` inside Docker), not the browser's
   WebSocket URL.
3. Use the vehicle id shown in the Fleet workspace as the VDA 5050
   `serialNumber`, and keep the manufacturer `cubot` unless the vehicle record
   says otherwise.

`examples/mock_robot.py` and `examples/mock_drone.py` are complete reference
vehicles. See `sdk/cubot-sdk/README.md` for the full API.

## API

All routes are under `/api/fleet` and require the project owner's token. Every
route returns 404 if the project does not exist or belongs to someone else.

| Method | Route | |
|---|---|---|
| GET | `/projects/{project}` | Project summary (name, dimension, robot and task counts). Creates the default 2D environment if there is none. |
| POST | `/projects/{project}/init` | `{dimension: "2d" \| "3d"}`: create or reset the environment and the default broker |
| GET / PUT | `/projects/{project}/environment` | Grid, obstacles, floor preset |
| GET / POST | `/projects/{project}/robots` | List / add robots |
| PUT (or PATCH) / DELETE | `/projects/{project}/robots/{robot}` | Update / remove a robot |
| POST | `/projects/{project}/robots/{robot}/sequence/{start,advance,complete,stop}` | Sequence control |
| | `/projects/{project}/drones...` | Same routes for drones |
| GET / POST | `/projects/{project}/tasks` | List / add tasks |
| PUT (or PATCH) / DELETE | `/projects/{project}/tasks/{task}` | Update / remove a task |
| POST | `/projects/{project}/tasks/reassign`, `/tasks/reassign-drones` | Greedy assignment |
| GET / POST | `/projects/{project}/categories` | List / add categories |
| PUT (or PATCH) / DELETE | `/projects/{project}/categories/{category}` | Update / remove a category |
| GET / POST / PUT (or PATCH) / DELETE | `/projects/{project}/broker` | The broker record (`mode`, `dispatch_active`) |
| POST | `/planning/run` | One path with a chosen algorithm, plus explored cells |
| POST | `/planning/routes` | Cooperative routes for several robots |
| POST | `/planning/drone-route` | A 3D route for a drone |

Data is stored in `fleet_environments`, `fleet_robots`, `fleet_drones`,
`fleet_tasks`, `fleet_categories` and `fleet_brokers`, all keyed by
`project_id`. Code: `backend/routes/fleet.py`, `backend/services/fleet/`,
`frontend/app/fleet/`, `sdk/cubot-sdk/`.

## Running locally

Start an MQTT broker. Either use the compose service:

```bash
docker compose up -d fleet-broker
```

or a throwaway Mosquitto with the same ports:

```bash
docker run --rm -p 1893:1883 -p 9011:9001 -v $PWD/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro eclipse-mosquitto:2
```

Then run the fleet coordinator next to the backend:

```bash
cd backend && MONGODB_URI=mongodb://localhost:27017 uv run python -m services.fleet.coordinator
```

With the defaults the backend, the coordinator and the browser all find the
broker on `localhost` (TCP 1893, WebSocket 9011). In Docker, `fleet-broker`
publishes TCP on 1893 for real vehicles, the WebSocket port is bound to
`127.0.0.1:9011` only, and browsers use `wss://<domain>/mqtt`, which nginx
proxies to `fleet-broker:9001`.

## Configuration

| Setting | Default | |
|---|---|---|
| `FLEET_MQTT_HOST` | `localhost` | Broker host for the coordinator (`fleet-broker` in docker-compose) |
| `FLEET_MQTT_PORT` | `1893` | Broker TCP port (`1883` inside docker-compose) |
| `FLEET_MQTT_WS_URL` | `ws://localhost:9011` | WebSocket URL the API puts on the broker record (`wss://${DOMAIN}/mqtt` in docker-compose) |
| `NEXT_PUBLIC_FLEET_MQTT_URL` | unset | Frontend fallback when the broker record has no `ws_url` (build argument in docker-compose) |
| `FLEET_POLL_INTERVAL_S` | 3.0 | How often the coordinator looks for new or removed brokers |
| `FLEET_TICK_INTERVAL_S` | 2.0 | Scheduler tick |
| `FLEET_MANUFACTURER` | `cubot` | Default VDA 5050 / uav manufacturer for new vehicles |
| `FLEET_CELL_SIZE_M` | 1.0 | Metres per grid cell |
| `FLEET_MAP_ORIGIN_X` / `_Y` | 0.0 | Grid origin in metres |
| `FLEET_ROBOT_CLEARANCE_CELLS` | 1 | Obstacle inflation for planning |
| `FLEET_HORIZON_BASE_NODES` | 4 | Nodes released ahead of a robot |
| `FLEET_VDA5050_ENABLED` / `FLEET_UAV_ENABLED` | true | Run the ground / aerial master control |
| `FLEET_VDA5050_INTERFACE`, `_MAJOR_VERSION`, `_VERSION` | `uagv`, 2, `2.0.0` | VDA 5050 topic and header settings |
| `FLEET_UAV_INTERFACE`, `_MAJOR_VERSION` | `uav`, 1 | uav topic settings |

## Known limitations

- **Broker security.** Mosquitto accepts anonymous clients on both listeners.
  Before connecting real hardware on a shared network, add authentication,
  per-vehicle ACLs (each vehicle may only use its own `<serial>` topics) and
  TLS. The SDK does not support credentials or TLS yet.
- **Duplicated models.** The SDK's message models and topics are a copy of the
  coordinator's (`backend/services/fleet/coordinator/vda5050` and `uav`). They
  must be changed together.
- **uav layer.** No order stitching and no factsheet exchange for drones.
- **One broker.** All projects share one Mosquitto instance; isolation comes
  only from topic namespaces and vehicle serials.
- **Coordinates.** Grid cells map to metres through one global cell size and
  origin, not per project.
