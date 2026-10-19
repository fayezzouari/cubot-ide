import asyncio
import json
import time
from math import inf

import aiomqtt
from bson import ObjectId

from core.config import settings
from services.fleet import db
from services.fleet.coordinator import sequence
from services.fleet.coordinator import topics as legacy_topics
from services.fleet.coordinator.eta import make_eta
from services.fleet.coordinator.scheduler import schedule
from services.fleet.coordinator.vda5050 import order_builder, protocol, topics
from services.fleet.coordinator.vda5050.geometry import world_to_cell
from services.fleet.coordinator.vda5050.messages import (
    Action,
    Connection,
    Factsheet,
    InstantActions,
    State,
    Visualization,
    now_iso,
)
from services.fleet.coordinator.vda5050.stitching import OrderStore

Cell = tuple[int, int]


class Vda5050Coordinator:
    def __init__(self, broker_id: str, project_id: str) -> None:
        self.broker_id = broker_id
        self.project_id = project_id
        self._online: dict[str, bool] = {}
        self._pos_cell: dict[str, Cell] = {}
        self._battery: dict[str, float] = {}
        self._facts: dict[str, dict] = {}
        self._fs_requested: set[str] = set()
        self._mfr: dict[str, str] = {}
        self._hdr: dict[tuple[str, str], int] = {}
        self._last_assignment: dict[str, str | None] = {}
        self._completed: set[str] = set()
        self._orders = OrderStore()
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
                    identifier=f"fleet-vda-{self.broker_id}",
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
                    await self._on_connection(
                        client, serial, Connection.model_validate_json(msg.payload)
                    )
                elif parsed.message_type == protocol.FACTSHEET:
                    self._on_factsheet(serial, Factsheet.model_validate_json(msg.payload))
            except Exception:
                continue

    async def _on_state(self, serial: str, state: State) -> None:
        if state.agvPosition:
            self._pos_cell[serial] = self._cell_of(
                state.agvPosition.x, state.agvPosition.y
            )
        if state.batteryState:
            self._battery[serial] = state.batteryState.batteryCharge
        for action_state in state.actionStates:
            if action_state.actionStatus == protocol.ActionStatus.FINISHED:
                await self._complete_task(action_state.actionId)

    async def _complete_task(self, action_id: str) -> None:
        if action_id in self._completed:
            return
        task_id = action_id.rsplit("-", 1)[0]
        try:
            oid = ObjectId(task_id)
        except Exception:
            return
        task = await db.tasks().find_one(
            {"_id": oid, "project_id": self.project_id, "status": {"$ne": "done"}}
        )
        if not task:
            return

        if task.get("sequence_index") is not None and task.get("assigned_robot_id"):
            robot = await db.robots().find_one(
                {"_id": ObjectId(task["assigned_robot_id"])}
            )
            if robot:
                await sequence.complete_sequence_task(
                    db.robots(), robot, self.project_id, "assigned_robot_id", task
                )
                self._completed.add(action_id)
                return

        res = await db.tasks().update_one(
            {"_id": oid, "status": {"$ne": "done"}}, {"$set": {"status": "done"}}
        )
        if res.modified_count:
            self._completed.add(action_id)

    def _on_visualization(self, serial: str, payload: bytes) -> None:
        viz = Visualization.model_validate_json(payload)
        if viz.agvPosition:
            self._pos_cell[serial] = self._cell_of(viz.agvPosition.x, viz.agvPosition.y)

    async def _on_connection(
        self, client: aiomqtt.Client, serial: str, conn: Connection
    ) -> None:
        online = conn.connectionState == protocol.ConnectionState.ONLINE
        self._online[serial] = online
        if online and serial not in self._facts and serial not in self._fs_requested:
            self._fs_requested.add(serial)
            await self._request_factsheet(client, serial)
        if not online:
            self._orders.clear(serial)
            self._fs_requested.discard(serial)

    def _on_factsheet(self, serial: str, fs: Factsheet) -> None:
        info: dict = {}
        if fs.physicalParameters:
            if fs.physicalParameters.speedMax:
                info["max_speed"] = fs.physicalParameters.speedMax
            footprint = max(
                fs.physicalParameters.length or 0.0,
                fs.physicalParameters.width or 0.0,
            )
            if footprint:
                info["clearance_cells"] = max(
                    1, int(round(footprint / (settings.FLEET_CELL_SIZE_M or 1.0) / 2))
                )
        if fs.protocolFeatures:
            agv_actions = fs.protocolFeatures.get("agvActions") or []
            info["actions"] = [
                a.get("actionType") for a in agv_actions if a.get("actionType")
            ]
        self._facts[serial] = info

    async def _ticker(self, client: aiomqtt.Client) -> None:
        while not self._stopped:
            await self._dispatch(client)
            await asyncio.sleep(settings.FLEET_TICK_INTERVAL_S)

    async def _dispatch(self, client: aiomqtt.Client) -> None:
        async with self._lock:
            broker = await db.brokers().find_one({"_id": ObjectId(self.broker_id)})
            if not (broker and broker.get("dispatch_active", True)):
                await self._halt(client)
                return

            robots, tasks, grid = await self._load()
            self._forget_redone(tasks)
            if not robots:
                return

            greedy_robots = [
                r for r in robots if r.get("sequence_status") in (None, "idle")
            ]
            greedy_tasks = [t for t in tasks if t.get("sequence_index") is None]

            sched = schedule(
                [{"id": r["id"], "position": r["position"], "speed": r["speed"],
                  "category_id": r["category_id"]} for r in greedy_robots],
                greedy_tasks,
                make_eta(grid),
            )

            queues: dict[str, list[dict]] = {r["id"]: [] for r in greedy_robots}
            task_cell = {t["id"]: t["cell"] for t in greedy_tasks}
            task_meta = {t["id"]: t for t in greedy_tasks}
            for res in sched:
                rid, tid = res["robot_id"], res["task_id"]
                if rid and tid in task_cell:
                    queues[rid].append({**task_meta[tid], "cell": task_cell[tid]})

            if broker.get("mode") == "live":
                now = time.time()
                for res in sched:
                    tid, rid = res["task_id"], res["robot_id"]
                    await db.tasks().update_one(
                        {"_id": ObjectId(tid)},
                        {"$set": {
                            "assigned_robot_id": rid,
                            "eta_s": res["eta_s"],
                            "status": "assigned" if rid else "pending",
                        }},
                    )
                    if self._last_assignment.get(tid) != rid:
                        self._last_assignment[tid] = rid
                        await client.publish(
                            legacy_topics.assignments(self.broker_id),
                            json.dumps({**res, "ts": now}),
                        )

            by_id = {r["id"]: r for r in greedy_robots}
            for rid, queue in queues.items():
                await self._emit_for_robot(client, by_id[rid], queue, grid)

            await self._dispatch_sequenced(client, robots, tasks, grid)

    async def _dispatch_sequenced(
        self, client: aiomqtt.Client, robots: list[dict], tasks: list[dict], grid
    ) -> None:
        for r in robots:
            if r.get("sequence_status") != "running":
                continue
            cursor = r.get("sequence_cursor", 0)
            task = next(
                (
                    t
                    for t in tasks
                    if t.get("sequence_index") == cursor
                    and t.get("assigned_robot_id") == r["id"]
                ),
                None,
            )
            if not task:
                continue
            await self._emit_for_robot(client, r, [task], grid)

    def _forget_redone(self, open_tasks: list[dict]) -> None:
        open_ids = {t["id"] for t in open_tasks}
        self._completed = {
            a for a in self._completed if a.rsplit("-", 1)[0] not in open_ids
        }

    async def _halt(self, client: aiomqtt.Client) -> None:
        for serial in self._orders.serials():
            mfr = self._mfr.get(serial, settings.FLEET_MANUFACTURER)
            await self._cancel_order(client, {"serial": serial, "manufacturer": mfr})
            self._orders.clear(serial)

    async def _emit_for_robot(
        self, client: aiomqtt.Client, robot: dict, queue: list[dict], grid
    ) -> None:
        serial = robot["serial"]
        if not self._online.get(serial, False):
            return

        if not queue:
            if self._orders.clear(serial):
                await self._cancel_order(client, robot)
            return

        start = self._pos_cell.get(serial) or robot["cell"]
        task_sequence = tuple(str(t["id"]) for t in queue)
        existing = self._orders.get(serial)

        if existing and existing.task_sequence == task_sequence:
            order = existing
        else:
            specs = order_builder.build_route(grid, start, queue)
            order = self._orders.open_order(
                serial, task_sequence, specs,
                released_upto=self._window(specs, start, 0),
            )
            await self._publish_order(client, robot, order)
            return

        idx = self._progress_index(order.specs, self._pos_cell.get(serial) or start)
        bumped = self._orders.release(serial, self._window(order.specs, start, idx))
        if bumped:
            await self._publish_order(client, robot, bumped)

    def _window(self, specs, _start, progress_idx: int) -> int:
        return min(len(specs) - 1, progress_idx + settings.FLEET_HORIZON_BASE_NODES)

    @staticmethod
    def _progress_index(specs, cell: Cell) -> int:
        best_i, best_d = 0, inf
        for i, s in enumerate(specs):
            d = (s.cell[0] - cell[0]) ** 2 + (s.cell[1] - cell[1]) ** 2
            if d <= best_d:
                best_d, best_i = d, i
        return best_i

    def _cell_of(self, x_m: float, y_m: float) -> Cell:
        col, row = world_to_cell(x_m, y_m)
        return (int(round(col)), int(round(row)))

    def _next_header(self, serial: str, message_type: str) -> int:
        key = (serial, message_type)
        self._hdr[key] = self._hdr.get(key, 0) + 1
        return self._hdr[key]

    async def _publish_order(self, client, robot, order) -> None:
        serial = robot["serial"]
        msg = order_builder.assemble(
            specs=order.specs,
            released_upto=order.released_upto,
            order_id=order.order_id,
            order_update_id=order.order_update_id,
            map_id=self.project_id,
            version=settings.FLEET_VDA5050_VERSION,
            manufacturer=robot["manufacturer"],
            serial=serial,
            header_id=self._next_header(serial, protocol.ORDER),
        )
        await client.publish(
            topics.topic(robot["manufacturer"], serial, protocol.ORDER),
            msg.model_dump_json(exclude_none=True),
        )

    async def _cancel_order(self, client, robot) -> None:
        serial = robot["serial"]
        msg = InstantActions(
            headerId=self._next_header(serial, protocol.INSTANT_ACTIONS),
            timestamp=now_iso(),
            version=settings.FLEET_VDA5050_VERSION,
            manufacturer=robot["manufacturer"],
            serialNumber=serial,
            actions=[Action(
                actionId=f"cancel-{int(time.time())}",
                actionType=protocol.CANCEL_ORDER,
                blockingType=protocol.BlockingType.HARD,
            )],
        )
        await client.publish(
            topics.topic(robot["manufacturer"], serial, protocol.INSTANT_ACTIONS),
            msg.model_dump_json(exclude_none=True),
        )

    async def _request_factsheet(self, client, serial: str) -> None:
        mfr = self._mfr.get(serial, settings.FLEET_MANUFACTURER)
        msg = InstantActions(
            headerId=self._next_header(serial, protocol.INSTANT_ACTIONS),
            timestamp=now_iso(),
            version=settings.FLEET_VDA5050_VERSION,
            manufacturer=mfr,
            serialNumber=serial,
            actions=[Action(
                actionId="factsheetRequest",
                actionType=protocol.FACTSHEET_REQUEST,
                blockingType=protocol.BlockingType.NONE,
            )],
        )
        await client.publish(
            topics.topic(mfr, serial, protocol.INSTANT_ACTIONS),
            msg.model_dump_json(exclude_none=True),
        )

    async def _load(self):
        cats = {}
        async for c in db.categories().find({"project_id": self.project_id}):
            cats[str(c["_id"])] = (c.get("name") or "").strip().lower()

        robots = []
        async for r in db.robots().find({"project_id": self.project_id}):
            rid = str(r["_id"])
            serial = r.get("serial_number") or rid
            mfr = r.get("manufacturer") or settings.FLEET_MANUFACTURER
            pos = r.get("position", {}) or {}
            db_cell = (int(round(pos.get("x", 0.0))), int(round(pos.get("y", 0.0))))
            cell = self._pos_cell.get(serial, db_cell)
            speed = self._facts.get(serial, {}).get("max_speed") or float(r.get("speed", 1.0))
            robots.append({
                "id": rid, "serial": serial, "manufacturer": mfr,
                "position": (float(cell[0]), float(cell[1]), 0.0),
                "cell": cell, "speed": speed, "category_id": r.get("category_id"),
                "sequence_status": r.get("sequence_status"),
                "sequence_cursor": r.get("sequence_cursor", 0),
            })

        tasks = []
        async for t in db.tasks().find(
            {
                "project_id": self.project_id,
                "status": {"$ne": "done"},
                "vehicle_kind": {"$ne": "aerial"},
            }
        ):
            p = t.get("position", {}) or {}
            cell = (int(round(p.get("x", 0.0))), int(round(p.get("y", 0.0))))
            tasks.append({
                "id": str(t["_id"]),
                "priority": int(t.get("priority", 1)),
                "deadline_s": t.get("deadline_s"),
                "category_ids": t.get("category_ids") or [],
                "position": (float(cell[0]), float(cell[1]), 0.0),
                "cell": cell,
                "action_type": _action_for(t, cats),
                "assigned_robot_id": t.get("assigned_robot_id"),
                "sequence_index": t.get("sequence_index"),
            })

        env = await db.environments().find_one({"project_id": self.project_id})
        grid = (env or {}).get("obstacles") or []
        return robots, tasks, grid


def _action_for(task: dict, categories: dict[str, str]) -> str:
    if task.get("action_type"):
        return task["action_type"]
    for cid in task.get("category_ids") or []:
        name = categories.get(str(cid))
        if name:
            return name.replace(" ", "_")
    return "pick"
