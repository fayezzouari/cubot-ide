from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable

import aiomqtt

from ..constants import DEFAULT_MANUFACTURER
from .messages import Connection, Factsheet, InstantActions, Order, State, Visualization
from .topics import Vda5050Topics

StateProvider = Callable[[], State]
FactsheetProvider = Callable[[], Factsheet]
OrderHandler = Callable[[Order], "Awaitable[None] | None"]
InstantActionsHandler = Callable[[InstantActions], "Awaitable[None] | None"]


class Vda5050Client:
    def __init__(
        self,
        mqtt_host: str,
        *,
        serial: str,
        get_state: StateProvider,
        project_id: str | None = None,
        manufacturer: str = DEFAULT_MANUFACTURER,
        get_factsheet: FactsheetProvider | None = None,
        mqtt_port: int = 1883,
        version: str = "2.0.0",
        publish_interval_s: float = 0.2,
        topics: Vda5050Topics | None = None,
    ) -> None:
        self._host = mqtt_host
        self._port = mqtt_port
        self.manufacturer = manufacturer
        self.serial = serial
        self.project_id = project_id
        self.version = version
        self.get_state = get_state
        self.get_factsheet = get_factsheet
        self.publish_interval_s = publish_interval_s
        self.topics = topics or Vda5050Topics()
        self._order_handlers: list[OrderHandler] = []
        self._instant_actions_handlers: list[InstantActionsHandler] = []
        self._header_ids: dict[str, int] = {}

    def on_order(self, handler: OrderHandler) -> OrderHandler:
        self._order_handlers.append(handler)
        return handler

    def on_instant_actions(self, handler: InstantActionsHandler) -> InstantActionsHandler:
        self._instant_actions_handlers.append(handler)
        return handler

    def _next_header_id(self, message_type: str) -> int:
        n = self._header_ids.get(message_type, 0) + 1
        self._header_ids[message_type] = n
        return n

    def _topic(self, message_type: str) -> str:
        return self.topics.topic(self.manufacturer, self.serial, message_type)

    def _connection(self, state: str) -> Connection:
        return Connection(
            headerId=self._next_header_id("connection"),
            version=self.version,
            manufacturer=self.manufacturer,
            serialNumber=self.serial,
            connectionState=state,
        )

    @staticmethod
    def _serialize(model) -> bytes:
        return model.model_dump_json(exclude_none=True).encode()

    async def run(self) -> None:
        will = aiomqtt.Will(
            topic=self._topic("connection"),
            payload=self._serialize(self._connection("CONNECTIONBROKEN")),
            qos=1,
            retain=True,
        )
        async with aiomqtt.Client(hostname=self._host, port=self._port, will=will) as client:
            await client.publish(
                self._topic("connection"), self._serialize(self._connection("ONLINE")), retain=True
            )
            if self.get_factsheet is not None:
                await client.publish(self._topic("factsheet"), self._serialize(self.get_factsheet()))

            await client.subscribe(self._topic("order"))
            await client.subscribe(self._topic("instantActions"))

            async with asyncio.TaskGroup() as tg:
                tg.create_task(self._heartbeat_loop(client))
                tg.create_task(self._listen_loop(client))

    async def _heartbeat_loop(self, client: aiomqtt.Client) -> None:
        while True:
            state = self.get_state()
            if self.project_id and state.agvPosition and not state.agvPosition.mapId:
                state.agvPosition.mapId = self.project_id
            await client.publish(self._topic("state"), self._serialize(state))
            await client.publish(
                self._topic("visualization"),
                self._serialize(
                    Visualization(
                        headerId=self._next_header_id("visualization"),
                        version=self.version,
                        manufacturer=self.manufacturer,
                        serialNumber=self.serial,
                        agvPosition=state.agvPosition,
                    )
                ),
            )
            await asyncio.sleep(self.publish_interval_s)

    async def _listen_loop(self, client: aiomqtt.Client) -> None:
        async for message in client.messages:
            topic = str(message.topic)
            if topic.endswith("/order"):
                await self._dispatch(self._order_handlers, Order.model_validate_json(message.payload))
            elif topic.endswith("/instantActions"):
                await self._dispatch(
                    self._instant_actions_handlers,
                    InstantActions.model_validate_json(message.payload),
                )

    @staticmethod
    async def _dispatch(handlers: list, message) -> None:
        for handler in handlers:
            result = handler(message)
            if inspect.isawaitable(result):
                await result
