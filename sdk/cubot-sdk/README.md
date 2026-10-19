# cubot-sdk

Vehicle-side SDK for connecting real robots and drones to the CuBot Fleet
Planner. It contains two clients:

- `cubot_sdk.vda5050`: a [VDA 5050](https://github.com/VDA5050/VDA5050) client
  for ground vehicles (AGVs and AMRs).
- `cubot_sdk.uav`: the aerial counterpart, which speaks CuBot's `uav/v1`
  protocol (VDA 5050 has no altitude, so drones use their own message set).

## What it does

The Fleet Planner's simulated vehicles and the fleet coordinator already talk
to each other over MQTT using these protocols. A real vehicle only has to
publish and subscribe the same topics as a simulated one. The SDK owns the
MQTT connection, the topic scheme, header bookkeeping, the heartbeat loop and
the connection last-will message, so an integration only implements two
things:

- `get_state()` returns the vehicle's real position, battery and errors.
- `on_order(...)` turns a released order's nodes (and edges, for ground
  vehicles) into real motion.

## Install

From the root of the CuBot repository:

```bash
pip install ./sdk/cubot-sdk
```

or, for an editable install with uv:

```bash
uv pip install -e sdk/cubot-sdk
```

Python 3.11 or newer is required. The only dependencies are `pydantic` and
`aiomqtt`.

## Connecting a robot

```python
import asyncio

from cubot_sdk.vda5050 import AgvPosition, Order, State, Vda5050Client


def get_state() -> State:
    return State(
        version="2.0.0",
        manufacturer="cubot",
        serialNumber="",
        driving=True,
        agvPosition=AgvPosition(x=1.2, y=3.4, theta=0.0, positionInitialized=True),
    )


client = Vda5050Client(
    "localhost",
    mqtt_port=1893,
    serial="<robot id from the Fleet workspace>",
    get_state=get_state,
)


@client.on_order
async def handle_order(order: Order) -> None:
    ...


asyncio.run(client.run())
```

The client fills in the header fields of the messages it builds itself
(connection, visualization). The `State` you return is published as it is, so
set its `manufacturer` and `serialNumber` to the same values you gave the
client. `examples/mock_robot.py` shows the pattern.

`client.run()` connects, publishes `connection` ONLINE (retained) and, if you
passed `get_factsheet`, a `factsheet`. It then publishes `state` and
`visualization` every `publish_interval_s` (0.2 s by default) and calls your
handlers for incoming `order` and `instantActions` messages. It runs until it
is cancelled. Reconnecting is up to you: wrap `run()` in your own retry loop so
connection failures stay visible.

## Connecting a drone

`UavClient` has the same shape. Positions carry an altitude `z` in metres,
orders contain only nodes (no edges), and `State` reports `flightStatus` and
`verticalSpeed` instead of `driving`. Report each delivery action as
`FINISHED` in `actionStates`, and keep reporting it on every heartbeat: the
fleet coordinator marks the aerial task done when it sees that status.

```python
from cubot_sdk.uav import AgvPosition, State, UavClient

client = UavClient("localhost", mqtt_port=1893, serial="<drone id>", get_state=get_state)
```

## Linking hardware to a Fleet workspace

1. In the Fleet workspace, open the broker panel and switch the broker to
   **live** mode. In live mode the app stops simulating vehicle positions and
   draws only what real vehicles report.
2. Point the client at the broker's plain MQTT TCP port, not the browser's
   WebSocket URL. In local development that is the `fleet-broker` service on
   `localhost:1893` (see the root `docker-compose.yml`); inside the Docker
   network it is `fleet-broker:1883`.
3. Use the vehicle id shown in the Fleet workspace as the `serialNumber`
   (the `serial` argument). The canvas and the fleet coordinator key telemetry
   and orders on it.
4. Keep the default manufacturer, `cubot`, unless the vehicle record in the
   workspace says otherwise. The coordinator accepts telemetry from any
   manufacturer, but it publishes orders to the manufacturer stored on the
   vehicle record.
5. Start your integration. The canvas shows the positions from your `state`
   messages, and the fleet coordinator plans routes and dispatches `order` and
   `instantActions` exactly as it does for a simulated fleet.

In **simulated** mode the browser drives the vehicles itself and publishes
their telemetry, so a real vehicle with the same serial would conflict with
it. Use live mode whenever real hardware is connected.

## Try it without hardware

The examples are complete reference vehicles. Start a broker, then run one of
them with the id of a robot or drone from your workspace:

```bash
docker run --rm -p 1893:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
python sdk/cubot-sdk/examples/mock_robot.py --host localhost --port 1893 --serial <robot id>
python sdk/cubot-sdk/examples/mock_drone.py --host localhost --port 1893 --serial <drone id>
```

The mock robot drives in straight lines between the released nodes of each
order and slowly drains its battery. The mock drone flies straight 3D legs
between waypoints and reports its actions as finished.

## Topics

```
uagv/v2/<manufacturer>/<serial>/order            coordinator -> vehicle
uagv/v2/<manufacturer>/<serial>/instantActions   coordinator -> vehicle
uagv/v2/<manufacturer>/<serial>/state            vehicle -> coordinator
uagv/v2/<manufacturer>/<serial>/visualization    vehicle -> coordinator
uagv/v2/<manufacturer>/<serial>/connection       vehicle -> coordinator
uagv/v2/<manufacturer>/<serial>/factsheet        vehicle -> coordinator

uav/v1/<manufacturer>/<serial>/order             coordinator -> drone
uav/v1/<manufacturer>/<serial>/instantActions    coordinator -> drone
uav/v1/<manufacturer>/<serial>/state             drone -> coordinator
uav/v1/<manufacturer>/<serial>/visualization     drone -> coordinator
uav/v1/<manufacturer>/<serial>/connection        drone -> coordinator
```

`Vda5050Topics` and `UavTopics` let you change the interface name or major
version if your fleet coordinator is configured differently.

## Security

The SDK connects over plain MQTT without authentication or TLS, which matches
the development broker. Do not expose that broker to an untrusted network. A
production setup that links real hardware should put the broker behind TLS,
give each vehicle its own credentials or client certificate, and use ACLs so a
vehicle can only publish and subscribe its own `<serial>` topics. The SDK does
not do any of this yet.

## Status

Early and unreleased. The message models and topics mirror the fleet
coordinator's own copies in `backend/services/fleet/coordinator`, and the two
must be changed together.
