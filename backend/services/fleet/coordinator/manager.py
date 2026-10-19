import asyncio

from core.config import settings
from services.fleet import db
from services.fleet.coordinator.coordinator import Coordinator
from services.fleet.coordinator.uav.coordinator import UavCoordinator
from services.fleet.coordinator.vda5050.coordinator import Vda5050Coordinator


class _BrokerCoordinators:
    def __init__(self, broker_id: str, project_id: str) -> None:
        self._coords = [Coordinator(broker_id, project_id)]
        if settings.FLEET_VDA5050_ENABLED:
            self._coords.append(Vda5050Coordinator(broker_id, project_id))
        if settings.FLEET_UAV_ENABLED:
            self._coords.append(UavCoordinator(broker_id, project_id))

    def start(self) -> None:
        for c in self._coords:
            c.start()

    async def stop(self) -> None:
        for c in self._coords:
            await c.stop()


class Manager:
    def __init__(self) -> None:
        self._coords: dict[str, _BrokerCoordinators] = {}
        self._stopped = False
        self._task: asyncio.Task | None = None

    @property
    def count(self) -> int:
        return len(self._coords)

    async def start(self) -> None:
        self._task = asyncio.create_task(self._poll())

    async def _poll(self) -> None:
        while not self._stopped:
            try:
                seen: set[str] = set()
                async for b in db.brokers().find({}):
                    bid = str(b["_id"])
                    seen.add(bid)
                    if bid not in self._coords:
                        coord = _BrokerCoordinators(bid, b["project_id"])
                        coord.start()
                        self._coords[bid] = coord
                for bid in list(self._coords):
                    if bid not in seen:
                        await self._coords.pop(bid).stop()
            except Exception:
                pass
            await asyncio.sleep(settings.FLEET_POLL_INTERVAL_S)

    async def stop(self) -> None:
        self._stopped = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        for coord in list(self._coords.values()):
            await coord.stop()
        self._coords.clear()


manager = Manager()
