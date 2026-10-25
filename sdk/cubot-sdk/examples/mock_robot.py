from __future__ import annotations

import argparse
import asyncio
import math

from cubot_sdk import DEFAULT_MANUFACTURER
from cubot_sdk.vda5050 import (
    AgvPosition,
    BatteryState,
    Factsheet,
    InstantActions,
    Order,
    PhysicalParameters,
    State,
    TypeSpecification,
    Vda5050Client,
)


class MockRobot:
    def __init__(self, cell_size_m: float = 1.0, speed_mps: float = 1.0) -> None:
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0
        self.battery = 100.0
        self.driving = False
        self.cell_size_m = cell_size_m
        self.speed_mps = speed_mps
        self._active_order: Order | None = None

    def state(self) -> State:
        self.battery = max(20.0, self.battery - 0.05)
        return State(
            version="2.0.0",
            manufacturer=DEFAULT_MANUFACTURER,
            serialNumber="",
            orderId=self._active_order.orderId if self._active_order else "",
            driving=self.driving,
            agvPosition=AgvPosition(
                x=self.x, y=self.y, theta=self.theta, mapId="", positionInitialized=True
            ),
            batteryState=BatteryState(batteryCharge=self.battery, charging=False),
        )

    def factsheet(self) -> Factsheet:
        return Factsheet(
            version="2.0.0",
            manufacturer=DEFAULT_MANUFACTURER,
            serialNumber="",
            typeSpecification=TypeSpecification(seriesName="mock", agvClass="FORKLIFT"),
            physicalParameters=PhysicalParameters(speedMax=self.speed_mps),
        )

    async def drive_order(self, order: Order) -> None:
        self._active_order = order
        self.driving = True
        for node in sorted(order.nodes, key=lambda n: n.sequenceId):
            if not node.released or node.nodePosition is None:
                continue
            await self._drive_to(node.nodePosition.x, node.nodePosition.y)
        self.driving = False

    async def _drive_to(self, tx: float, ty: float) -> None:
        while math.hypot(tx - self.x, ty - self.y) > 0.05:
            dx, dy = tx - self.x, ty - self.y
            dist = math.hypot(dx, dy)
            step = min(dist, self.speed_mps * self.cell_size_m * 0.1)
            self.theta = math.atan2(dy, dx)
            self.x += dx / dist * step
            self.y += dy / dist * step
            await asyncio.sleep(0.1)


async def main() -> None:
    p = argparse.ArgumentParser(
        description="Mock VDA 5050 robot for the CuBot Fleet Planner."
    )
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=1893)
    p.add_argument("--manufacturer", default=DEFAULT_MANUFACTURER)
    p.add_argument("--serial", required=True, help="the robot serial shown in the Fleet workspace")
    p.add_argument("--project", help="Fleet project id; the robot is added to it on first connection if missing")
    p.add_argument("--start", type=float, nargs=2, default=(0.0, 0.0), metavar=("X", "Y"),
                   help="start position in metres")
    args = p.parse_args()

    robot = MockRobot()
    robot.x, robot.y = args.start

    def get_state() -> State:
        s = robot.state()
        s.manufacturer = args.manufacturer
        s.serialNumber = args.serial
        return s

    def get_factsheet() -> Factsheet:
        f = robot.factsheet()
        f.manufacturer = args.manufacturer
        f.serialNumber = args.serial
        return f

    client = Vda5050Client(
        args.host,
        mqtt_port=args.port,
        manufacturer=args.manufacturer,
        serial=args.serial,
        project_id=args.project,
        get_state=get_state,
        get_factsheet=get_factsheet,
    )

    @client.on_order
    async def handle_order(order: Order) -> None:
        await robot.drive_order(order)

    @client.on_instant_actions
    def handle_instant_actions(actions: InstantActions) -> None:
        print(f"instantActions: {[a.actionType for a in actions.actions]}")

    print(f"mock robot {args.serial} connecting to {args.host}:{args.port} ...")
    await client.run()


if __name__ == "__main__":
    asyncio.run(main())
