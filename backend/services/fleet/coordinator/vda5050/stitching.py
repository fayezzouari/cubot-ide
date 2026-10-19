from dataclasses import dataclass

from services.fleet.coordinator.vda5050.order_builder import NodeSpec


@dataclass
class RobotOrder:
    order_id: str
    order_update_id: int
    task_sequence: tuple[str, ...]
    specs: list[NodeSpec]
    released_upto: int


class OrderStore:
    def __init__(self) -> None:
        self._orders: dict[str, RobotOrder] = {}
        self._counter: dict[str, int] = {}

    def get(self, serial: str) -> RobotOrder | None:
        return self._orders.get(serial)

    def open_order(
        self, serial: str, task_sequence: tuple[str, ...],
        specs: list[NodeSpec], released_upto: int,
    ) -> RobotOrder:
        n = self._counter.get(serial, 0) + 1
        self._counter[serial] = n
        order = RobotOrder(
            order_id=f"{serial}-{n}",
            order_update_id=0,
            task_sequence=tuple(task_sequence),
            specs=specs,
            released_upto=released_upto,
        )
        self._orders[serial] = order
        return order

    def release(self, serial: str, released_upto: int) -> RobotOrder | None:
        order = self._orders.get(serial)
        if not order or released_upto <= order.released_upto:
            return None
        order.released_upto = released_upto
        order.order_update_id += 1
        return order

    def clear(self, serial: str) -> bool:
        return self._orders.pop(serial, None) is not None

    def serials(self) -> list[str]:
        return list(self._orders)
