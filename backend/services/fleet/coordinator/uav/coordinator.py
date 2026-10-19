import asyncio
import time

import aiomqtt
from bson import ObjectId

from core.config import settings
from services.fleet import db
from services.fleet.coordinator import sequence
from services.fleet.coordinator.uav import protocol, topics
from services.fleet.coordinator.uav.messages import (
    Action,
    AgvPosition,
    Connection,
    InstantActions,
    Node,
    NodePosition,
    Order,
    State,
    Visualization,
)
from services.fleet.coordinator.uav.pathing import astar3d_path
from services.fleet.coordinator.vda5050.geometry import cell_to_world, world_to_cell

Cell3D = tuple[int, int, int]


class UavCoordinator:
    def __init__(self, broker_id: str, project_id: str) -> None:
        self.broker_id = broker_id
        self.project_id = project_id
        self._online: dict[str, bool] = {}
        self._pos_cell: dict[str, Cell3D] = {}
        self._mfr: dict[str, str] = {}
        self._hdr: dict[tuple[str, str], int] = {}
        self._dispatched: dict[str, str] = {}
        self._completed: set[str] = set()
        self._lock = asyncio.Lock()
        self._stopped = False
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopped = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while not self._stopped:
            try:
                async with aiomqtt.Client(
                    hostname=settings.FLEET_MQTT_HOST,
                    port=settings.FLEET_MQTT_PORT,
                    identifier=f"fleet-uav-{self.broker_id}",
                ) as client:
                    for mt in protocol.VEHICLE_TO_MASTER:
                        await client.subscribe(topics.subscribe_wildcard(mt))
                    await asyncio.gather(self._listen(client), self._ticker(client))
            except asyncio.CancelledError:
                raise
            except Exception:
                if self._stopped:
                    return
                await asyncio.sleep(2)

    async def _listen(self, client: aiomqtt.Client) -> None:
        async for msg in client.messages:
            parsed = topics.parse(str(msg.topic))
            if not parsed:
                continue
            serial = parsed.serial
            self._mfr[serial] = parsed.manufacturer
            try:
                if parsed.message_type == protocol.STATE:
                    await self._on_state(serial, State.model_validate_json(msg.payload))
                elif parsed.message_type == protocol.VISUALIZATION:
                    self._on_visualization(serial, msg.payload)
                elif parsed.message_type == protocol.CONNECTION:
                    self._on_connection(serial, Connection.model_validate_json(msg.payload))
            except Exception:
                continue

    async def _on_state(self, serial: str, state: State) -> None:
        if state.agvPosition:
            self._pos_cell[serial] = self._cell_of(state.agvPosition)
        for action_state in state.actionStates:
            if action_state.actionStatus == protocol.ActionStatus.FINISHED:
                await self._complete_task(serial, action_state.actionId)

    async def _complete_task(self, serial: str, task_id: str) -> None:
        if task_id in self._completed:
            return
        try:
            oid = ObjectId(task_id)
        except Exception:
            return
        task = await db.tasks().find_one(
            {"_id": oid, "project_id": self.project_id, "status": {"$ne": "done"}}
        )
        if not task:
            return

        if task.get("sequence_index") is not None and task.get("assigned_drone_id"):
            drone = await db.drones().find_one(
                {"_id": ObjectId(task["assigned_drone_id"])}
            )
            if drone:
                await sequence.complete_sequence_task(
                    db.drones(), drone, self.project_id, "assigned_drone_id", task
                )
                self._completed.add(task_id)
                self._dispatched.pop(serial, None)
                return

        res = await db.tasks().update_one(
            {"_id": oid, "status": {"$ne": "done"}}, {"$set": {"status": "done"}}
        )
        if res.modified_count:
            self._completed.add(task_id)
            self._dispatched.pop(serial, None)

    def _on_visualization(self, serial: str, payload: bytes) -> None:
        viz = Visualization.model_validate_json(payload)
        if viz.agvPosition:
            self._pos_cell[serial] = self._cell_of(viz.agvPosition)

    def _on_connection(self, serial: str, conn: Connection) -> None:
        online = conn.connectionState == protocol.ConnectionState.ONLINE
        self._online[serial] = online
        if not online:
            self._dispatched.pop(serial, None)

    async def _ticker(self, client: aiomqtt.Client) -> None:
        while not self._stopped:
            await self._dispatch(client)
            await asyncio.sleep(settings.FLEET_TICK_INTERVAL_S)

    async def _dispatch(self, client: aiomqtt.Client) -> None:
        async with self._lock:
            broker = await db.brokers().find_one({"_id": ObjectId(self.broker_id)})
            if not (broker and broker.get("dispatch_active", True)):
                return

            drones, tasks_by_drone, grid, depth = await self._load()
            self._forget_redone(tasks_by_drone)

            for drone in drones:
                serial = drone["serial"]
                if not self._online.get(serial, False):
                    continue

                task = tasks_by_drone.get(drone["id"])
                if not task:
                    if serial in self._dispatched:
                        await self._cancel_order(client, drone)
                        self._dispatched.pop(serial, None)
                    continue

                if self._dispatched.get(serial) == task["id"]:
                    continue

                start = self._pos_cell.get(serial) or drone["cell3d"]
                goal = task["cell3d"]
                path = astar3d_path(grid, depth, start, goal) if grid else None
                if not path:
                    path = [start, goal]

                await self._publish_order(client, drone, task, path)
                self._dispatched[serial] = task["id"]

    def _forget_redone(self, tasks_by_drone: dict[str, dict]) -> None:
        open_ids = {t["id"] for t in tasks_by_drone.values()}
        self._completed = {a for a in self._completed if a not in open_ids}

    def _cell_of(self, pos: AgvPosition) -> Cell3D:
        col, row = world_to_cell(pos.x, pos.y)
        return (int(round(col)), int(round(row)), int(round(pos.z)))

    def _next_header(self, serial: str, message_type: str) -> int:
        key = (serial, message_type)
        self._hdr[key] = self._hdr.get(key, 0) + 1
        return self._hdr[key]

    async def _publish_order(
        self, client: aiomqtt.Client, drone: dict, task: dict, path: list[Cell3D]
    ) -> None:
        serial = drone["serial"]
        nodes: list[Node] = []
        for i, (col, row, z) in enumerate(path):
            x_m, y_m = cell_to_world(col, row)
            actions = (
                [
                    Action(
                        actionId=task["id"],
                        actionType="deliver",
                        blockingType=protocol.BlockingType.NONE,
                    )
                ]
                if i == len(path) - 1
                else []
            )
            nodes.append(
                Node(
                    nodeId=f"n{i}",
                    sequenceId=i,
                    nodePosition=NodePosition(x=x_m, y=y_m, z=float(z), mapId=self.project_id),
                    actions=actions,
                )
            )
        msg = Order(
            headerId=self._next_header(serial, protocol.ORDER),
            version="1.0.0",
            manufacturer=drone["manufacturer"],
            serialNumber=serial,
            orderId=f"{task['id']}-{self._next_header(serial, 'order-id')}",
            orderUpdateId=0,
            nodes=nodes,
        )
        await client.publish(
            topics.topic(drone["manufacturer"], serial, protocol.ORDER),
            msg.model_dump_json(exclude_none=True),
        )

    async def _cancel_order(self, client: aiomqtt.Client, drone: dict) -> None:
        serial = drone["serial"]
        msg = InstantActions(
            headerId=self._next_header(serial, protocol.INSTANT_ACTIONS),
            version="1.0.0",
            manufacturer=drone["manufacturer"],
            serialNumber=serial,
            actions=[
                Action(
                    actionId=f"cancel-{int(time.time())}",
                    actionType=protocol.CANCEL_ORDER,
                    blockingType=protocol.BlockingType.HARD,
                )
            ],
        )
        await client.publish(
            topics.topic(drone["manufacturer"], serial, protocol.INSTANT_ACTIONS),
            msg.model_dump_json(exclude_none=True),
        )

    async def _load(self):
        drones = []
        drone_seq: dict[str, dict] = {}
        async for d in db.drones().find({"project_id": self.project_id}):
            did = str(d["_id"])
            serial = d.get("serial_number") or did
            mfr = d.get("manufacturer") or settings.FLEET_MANUFACTURER
            pos = d.get("position", {}) or {}
            cell3d = (
                int(round(pos.get("x", 0.0))),
                int(round(pos.get("y", 0.0))),
                int(round(pos.get("z", 0.0))),
            )
            drones.append({"id": did, "serial": serial, "manufacturer": mfr, "cell3d": cell3d})
            drone_seq[did] = {
                "status": d.get("sequence_status"),
                "cursor": d.get("sequence_cursor", 0),
            }

        env = await db.environments().find_one({"project_id": self.project_id})
        grid = (env or {}).get("obstacles") or []
        depth = max(1, int((env or {}).get("depth", 1)))

        tasks_by_drone: dict[str, dict] = {}
        async for t in db.tasks().find(
            {
                "project_id": self.project_id,
                "vehicle_kind": "aerial",
                "assigned_drone_id": {"$ne": None},
                "status": {"$ne": "done"},
            }
        ):
            did = t["assigned_drone_id"]
            seq_idx = t.get("sequence_index")
            seq = drone_seq.get(did, {})
            if seq.get("status") == "running":
                if seq_idx != seq.get("cursor", 0):
                    continue
            elif seq_idx is not None:
                continue

            p = t.get("position", {}) or {}
            cell3d = (
                int(round(p.get("x", 0.0))),
                int(round(p.get("y", 0.0))),
                int(round(p.get("z", 0.0))),
            )
            tasks_by_drone[did] = {"id": str(t["_id"]), "cell3d": cell3d}

        return drones, tasks_by_drone, grid, depth
