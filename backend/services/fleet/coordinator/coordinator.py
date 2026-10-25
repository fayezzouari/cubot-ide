import asyncio
import json
import time

import aiomqtt
from bson import ObjectId

from core.config import settings
from services.fleet import db
from services.fleet.coordinator import topics
from services.fleet.coordinator.eta import make_eta
from services.fleet.coordinator.scheduler import schedule


class Coordinator:
    def __init__(self, broker_id: str, project_id: str) -> None:
        self.broker_id = broker_id
        self.project_id = project_id
        self._loc: dict[str, tuple[float, float, float]] = {}
        self._seen: set[str] = set()
        self._last_assignment: dict[str, str | None] = {}
        self._counts = (0, 0)
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
                    identifier=f"fleet-{self.broker_id}",
                ) as client:
                    await client.subscribe(topics.loc_wildcard(self.broker_id))
                    await client.subscribe(topics.priority(self.broker_id))
                    await asyncio.gather(self._listen(client), self._ticker(client))
            except asyncio.CancelledError:
                raise
            except Exception:
                if self._stopped:
                    return
                await asyncio.sleep(2)

    async def _listen(self, client: aiomqtt.Client) -> None:
        async for msg in client.messages:
            topic = str(msg.topic)
            if topic.endswith("/loc"):
                rid = topics.robot_id_from_loc(topic)
                if not rid:
                    continue
                try:
                    d = json.loads(msg.payload)
                except (ValueError, TypeError):
                    continue
                self._loc[rid] = (
                    float(d.get("x", 0.0)),
                    float(d.get("y", 0.0)),
                    float(d.get("z", 0.0)),
                )
            elif topic == topics.priority(self.broker_id):
                await self._reschedule(client)

    async def _ticker(self, client: aiomqtt.Client) -> None:
        while not self._stopped:
            await self._reschedule(client)
            await self._publish_status(client)
            await asyncio.sleep(settings.FLEET_TICK_INTERVAL_S)

    async def _load(self):
        robots = []
        async for r in db.robots().find({
            "project_id": self.project_id,
            "sequence_status": {"$in": [None, "idle"]},
        }):
            rid = str(r["_id"])
            pos = r.get("position", {}) or {}
            cached = self._loc.get(rid)
            position = cached or (
                float(pos.get("x", 0.0)),
                float(pos.get("y", 0.0)),
                float(pos.get("z", 0.0)),
            )
            robots.append({
                "id": rid,
                "position": position,
                "speed": float(r.get("speed", 1.0)),
                "category_id": r.get("category_id"),
            })

        tasks = []
        async for t in db.tasks().find({
            "project_id": self.project_id,
            "status": {"$ne": "done"},
            "vehicle_kind": {"$ne": "aerial"},
            "sequence_index": None,
        }):
            p = t.get("position", {}) or {}
            tasks.append({
                "id": str(t["_id"]),
                "name": t.get("name", ""),
                "priority": int(t.get("priority", 1)),
                "deadline_s": t.get("deadline_s"),
                "category_ids": t.get("category_ids") or [],
                "position": (float(p.get("x", 0.0)), float(p.get("y", 0.0)), float(p.get("z", 0.0))),
            })

        env = await db.environments().find_one({"project_id": self.project_id})
        grid = (env or {}).get("obstacles") or []
        return robots, tasks, grid

    async def _reschedule(self, client: aiomqtt.Client) -> None:
        async with self._lock:
            broker = await db.brokers().find_one({"_id": ObjectId(self.broker_id)})
            if not (broker and broker.get("dispatch_active", True)):
                return

            robots, tasks, grid = await self._load()
            self._counts = (len(robots), len(tasks))
            now = time.time()

            for t in tasks:
                if t["id"] not in self._seen:
                    self._seen.add(t["id"])
                    await client.publish(
                        topics.priority(self.broker_id),
                        json.dumps({
                            "task_id": t["id"], "name": t["name"], "priority": t["priority"],
                            "position": {"x": t["position"][0], "y": t["position"][1], "z": t["position"][2]},
                            "deadline_s": t["deadline_s"], "action": "new", "ts": now,
                        }),
                    )

            if broker.get("mode") != "simulated" or not broker.get("auto_assign", True):
                return

            results = schedule(robots, tasks, make_eta(grid))
            for res in results:
                tid = res["task_id"]
                rid = res["robot_id"]
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
                        topics.assignments(self.broker_id),
                        json.dumps({**res, "ts": now}),
                    )

    async def _publish_status(self, client: aiomqtt.Client) -> None:
        robots, open_tasks = self._counts
        await client.publish(
            topics.status(self.broker_id),
            json.dumps({"online": True, "robots": robots, "open_tasks": open_tasks, "ts": time.time()}),
            retain=True,
        )
