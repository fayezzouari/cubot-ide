from __future__ import annotations

import argparse
import asyncio
import math

from cubot_sdk import DEFAULT_MANUFACTURER
from cubot_sdk.uav import (
    ActionState,
    AgvPosition,
    BatteryState,
    InstantActions,
    Order,
    State,
    UavClient,
)


class MockDrone:
    def __init__(self, cell_size_m: float = 1.0, speed_mps: float = 2.0) -> None:
        self.x = 0.0
        self.y = 0.0
        self.z = 0.0
        self.battery = 100.0
        self.flight_status = "IDLE"
        self.vertical_speed = 0.0
        self.cell_size_m = cell_size_m
        self.speed_mps = speed_mps
        self._active_order: Order | None = None
        self._action_states: dict[str, ActionState] = {}

    def state(self) -> State:
        self.battery = max(20.0, self.battery - 0.05)
        return State(
            version="1.0.0",
            manufacturer=DEFAULT_MANUFACTURER,
            serialNumber="",
            orderId=self._active_order.orderId if self._active_order else "",
            flightStatus=self.flight_status,
            verticalSpeed=self.vertical_speed,
            agvPosition=AgvPosition(
                x=self.x, y=self.y, z=self.z, mapId="", positionInitialized=True
            ),
            batteryState=BatteryState(batteryCharge=self.battery, charging=False),
            actionStates=list(self._action_states.values()),
        )

    async def fly_order(self, order: Order) -> None:
        self._active_order = order
        for node in sorted(order.nodes, key=lambda n: n.sequenceId):
            await self._fly_to(node.nodePosition.x, node.nodePosition.y, node.nodePosition.z)
            for action in node.actions:
                self._action_states[action.actionId] = ActionState(
                    actionId=action.actionId,
                    actionStatus="FINISHED",
                    actionType=action.actionType,
                )
        self.flight_status = "LANDED" if self.z == 0 else "HOVER"
        self.vertical_speed = 0.0

    async def _fly_to(self, tx: float, ty: float, tz: float) -> None:
        self.flight_status = "TAKEOFF" if tz > self.z else "CRUISE"
        while math.dist((tx, ty, tz), (self.x, self.y, self.z)) > 0.05:
            dx, dy, dz = tx - self.x, ty - self.y, tz - self.z
            dist = math.dist((tx, ty, tz), (self.x, self.y, self.z))
            step = min(dist, self.speed_mps * self.cell_size_m * 0.1)
            self.x += dx / dist * step
            self.y += dy / dist * step
            self.z += dz / dist * step
            self.vertical_speed = dz / dist * step / 0.1
            self.flight_status = (
                "TAKEOFF" if dz > 0.01 else "LANDING" if dz < -0.01 else "CRUISE"
            )
            await asyncio.sleep(0.1)
        self.vertical_speed = 0.0


async def main() -> None:
    p = argparse.ArgumentParser(
        description="Mock uav drone for the CuBot Fleet Planner."
    )
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=1893)
    p.add_argument("--manufacturer", default=DEFAULT_MANUFACTURER)
    p.add_argument("--serial", required=True, help="the drone id shown in the Fleet workspace")
    args = p.parse_args()

    drone = MockDrone()

    def get_state() -> State:
        s = drone.state()
        s.manufacturer = args.manufacturer
        s.serialNumber = args.serial
        return s

    client = UavClient(
        args.host,
        mqtt_port=args.port,
        manufacturer=args.manufacturer,
        serial=args.serial,
        get_state=get_state,
    )

    @client.on_order
    async def handle_order(order: Order) -> None:
        await drone.fly_order(order)

    @client.on_instant_actions
    def handle_instant_actions(actions: InstantActions) -> None:
        print(f"instantActions: {[a.actionType for a in actions.actions]}")

    print(f"mock drone {args.serial} connecting to {args.host}:{args.port} ...")
    await client.run()


if __name__ == "__main__":
    asyncio.run(main())
