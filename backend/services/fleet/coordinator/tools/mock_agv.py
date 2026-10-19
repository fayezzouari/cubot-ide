import argparse
import asyncio
import contextlib
import json
import signal
from math import atan2, hypot

import aiomqtt

from core.config import settings
from services.fleet.coordinator.vda5050 import geometry, protocol, topics
from services.fleet.coordinator.vda5050.messages import now_iso


class MockAgv:
    def __init__(self, args: argparse.Namespace) -> None:
        self.serial = args.serial
        self.mfr = args.manufacturer
        self.speed = args.speed
        self.interval = args.interval
        sx, sy = geometry.cell_to_world(*[float(v) for v in args.start.split(",")])
        self.x, self.y, self.theta = sx, sy, 0.0
        self.map_id = ""
        self.battery = 100.0
        self.order_id = ""
        self.order_update = -1
        self.nodes: list[dict] = []
        self.last_seq = 0
        self.last_node_id = ""
        self.driving = False
        self._hdr: dict[str, int] = {}

    def _h(self, mt: str) -> int:
        self._hdr[mt] = self._hdr.get(mt, 0) + 1
        return self._hdr[mt]

    def _topic(self, mt: str) -> str:
        return topics.topic(self.mfr, self.serial, mt)

    def _base(self, mt: str) -> dict:
        return {
            "headerId": self._h(mt), "timestamp": now_iso(),
            "version": settings.FLEET_VDA5050_VERSION,
            "manufacturer": self.mfr, "serialNumber": self.serial,
        }

    async def run(self) -> None:
        will = aiomqtt.Will(
            topic=self._topic(protocol.CONNECTION),
            payload=json.dumps({
                **self._base(protocol.CONNECTION),
                "connectionState": protocol.ConnectionState.CONNECTIONBROKEN,
            }),
            qos=1, retain=True,
        )
        async with aiomqtt.Client(
            hostname=settings.FLEET_MQTT_HOST, port=settings.FLEET_MQTT_PORT,
            identifier=f"mock-agv-{self.serial}", will=will,
        ) as client:
            self._client = client
            await self._publish_connection(protocol.ConnectionState.ONLINE)
            await client.subscribe(self._topic(protocol.ORDER))
            await client.subscribe(self._topic(protocol.INSTANT_ACTIONS))
            print(f"[{self.serial}] online at ({self.x:.1f},{self.y:.1f}) m")
            try:
                await asyncio.gather(self._listen(client), self._drive_loop(client))
            finally:
                await self._publish_connection(protocol.ConnectionState.OFFLINE)

    async def _publish_connection(self, state: str) -> None:
        await self._client.publish(
            self._topic(protocol.CONNECTION),
            json.dumps({**self._base(protocol.CONNECTION), "connectionState": state}),
            qos=1, retain=True,
        )

    async def _listen(self, client: aiomqtt.Client) -> None:
        async for msg in client.messages:
            parsed = topics.parse(str(msg.topic))
            if not parsed:
                continue
            data = json.loads(msg.payload)
            if parsed.message_type == protocol.ORDER:
                self._on_order(data)
            elif parsed.message_type == protocol.INSTANT_ACTIONS:
                await self._on_instant(client, data)

    def _on_order(self, data: dict) -> None:
        oid, oupd = data["orderId"], data["orderUpdateId"]
        nodes = data.get("nodes", [])
        if oid != self.order_id:
            self.order_id, self.order_update, self.nodes = oid, oupd, nodes
            first = nodes[0] if nodes else None
            if first:
                self.last_seq = first["sequenceId"]
                self.last_node_id = first["nodeId"]
            print(f"[{self.serial}] new order {oid} ({len(nodes)} nodes)")
        elif oupd > self.order_update:
            self.order_update, self.nodes = oupd, nodes
            print(f"[{self.serial}] order {oid} update {oupd} (released window widened)")

    async def _on_instant(self, client: aiomqtt.Client, data: dict) -> None:
        for action in data.get("actions", []):
            atype = action.get("actionType")
            if atype == protocol.CANCEL_ORDER:
                self.order_id, self.nodes, self.driving = "", [], False
                print(f"[{self.serial}] order cancelled")
            elif atype == protocol.FACTSHEET_REQUEST:
                await self._publish_factsheet(client)
                print(f"[{self.serial}] sent factsheet")

    async def _drive_loop(self, client: aiomqtt.Client) -> None:
        while True:
            self._step()
            await self._publish_state(client)
            await self._publish_visualization(client)
            await asyncio.sleep(self.interval)

    def _next_node(self) -> dict | None:
        for n in self.nodes:
            if n["sequenceId"] > self.last_seq and n.get("released") and n.get("nodePosition"):
                return n
        return None

    def _step(self) -> None:
        self.battery = max(0.0, self.battery - 0.05)
        target = self._next_node()
        if not target:
            self.driving = False
            return
        tp = target["nodePosition"]
        if not self.map_id:
            self.map_id = tp.get("mapId", "")
        dx, dy = tp["x"] - self.x, tp["y"] - self.y
        dist = hypot(dx, dy)
        reach = self.speed * self.interval
        if dist <= reach or dist == 0.0:
            self.x, self.y = tp["x"], tp["y"]
            self.last_seq = target["sequenceId"]
            self.last_node_id = target["nodeId"]
            self.driving = False
        else:
            self.theta = atan2(dy, dx)
            self.x += dx / dist * reach
            self.y += dy / dist * reach
            self.driving = True

    def _remaining_nodes(self) -> list[dict]:
        return [
            {"nodeId": n["nodeId"], "sequenceId": n["sequenceId"], "released": n.get("released", False)}
            for n in self.nodes if n["sequenceId"] > self.last_seq
        ]

    def _action_states(self) -> list[dict]:
        done = []
        for n in self.nodes:
            if n["sequenceId"] <= self.last_seq:
                for a in n.get("actions", []):
                    done.append({
                        "actionId": a["actionId"], "actionType": a["actionType"],
                        "actionStatus": protocol.ActionStatus.FINISHED,
                    })
        return done

    async def _publish_state(self, client: aiomqtt.Client) -> None:
        payload = {
            **self._base(protocol.STATE),
            "orderId": self.order_id, "orderUpdateId": max(0, self.order_update),
            "lastNodeId": self.last_node_id, "lastNodeSequenceId": self.last_seq,
            "driving": self.driving, "paused": False, "operatingMode": protocol.OperatingMode.AUTOMATIC,
            "nodeStates": self._remaining_nodes(), "edgeStates": [],
            "actionStates": self._action_states(),
            "agvPosition": {
                "x": self.x, "y": self.y, "theta": self.theta,
                "mapId": self.map_id, "positionInitialized": True,
            },
            "batteryState": {"batteryCharge": round(self.battery, 1), "charging": False},
            "errors": [],
            "safetyState": {"eStop": protocol.EStop.NONE, "fieldViolation": False},
        }
        await client.publish(self._topic(protocol.STATE), json.dumps(payload))

    async def _publish_visualization(self, client: aiomqtt.Client) -> None:
        payload = {
            **self._base(protocol.VISUALIZATION),
            "agvPosition": {
                "x": self.x, "y": self.y, "theta": self.theta,
                "mapId": self.map_id, "positionInitialized": True,
            },
        }
        await client.publish(self._topic(protocol.VISUALIZATION), json.dumps(payload))

    async def _publish_factsheet(self, client: aiomqtt.Client) -> None:
        payload = {
            **self._base(protocol.FACTSHEET),
            "typeSpecification": {"seriesName": "mock", "agvClass": "CARRIER", "maxLoadMass": 50.0},
            "physicalParameters": {
                "speedMin": 0.1, "speedMax": self.speed,
                "accelerationMax": 1.0, "decelerationMax": 1.0,
                "heightMax": 0.5, "length": 1.2, "width": 0.8,
            },
            "protocolFeatures": {
                "agvActions": [
                    {"actionType": "pick", "actionScopes": ["NODE"]},
                    {"actionType": "drop", "actionScopes": ["NODE"]},
                ],
            },
        }
        await client.publish(
            self._topic(protocol.FACTSHEET), json.dumps(payload), retain=True
        )


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="VDA 5050 mock AGV")
    p.add_argument("--serial", required=True, help="serialNumber (match the robot _id to drive a real task)")
    p.add_argument("--manufacturer", default=settings.FLEET_MANUFACTURER)
    p.add_argument("--start", default="0,0", help="start cell 'col,row'")
    p.add_argument("--speed", type=float, default=1.0, help="metres/second")
    p.add_argument("--interval", type=float, default=0.5, help="state publish period (s)")
    return p.parse_args()


async def _main() -> None:
    agv = MockAgv(_parse_args())
    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, lambda: stop.cancel())
    task = asyncio.create_task(agv.run())
    with contextlib.suppress(asyncio.CancelledError):
        await stop
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_main())
