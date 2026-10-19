from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


class _Header(BaseModel):
    headerId: int = 0
    timestamp: str = Field(default_factory=now_iso)
    version: str
    manufacturer: str
    serialNumber: str


class Action(BaseModel):
    actionId: str
    actionType: str
    blockingType: str
    actionDescription: str | None = None


class NodePosition(BaseModel):
    x: float
    y: float
    z: float
    mapId: str


class Node(BaseModel):
    nodeId: str
    sequenceId: int
    nodePosition: NodePosition
    actions: list[Action] = Field(default_factory=list)


class Order(_Header):
    orderId: str
    orderUpdateId: int
    nodes: list[Node]


class InstantActions(_Header):
    actions: list[Action]


class Connection(_Header):
    connectionState: str


class AgvPosition(BaseModel):
    model_config = ConfigDict(extra="allow")
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    mapId: str = ""
    positionInitialized: bool = False


class BatteryState(BaseModel):
    model_config = ConfigDict(extra="allow")
    batteryCharge: float = 100.0
    charging: bool = False


class ActionState(BaseModel):
    model_config = ConfigDict(extra="allow")
    actionId: str
    actionStatus: str
    actionType: str | None = None


class State(_Header):
    model_config = ConfigDict(extra="allow")
    orderId: str = ""
    orderUpdateId: int = 0
    lastNodeId: str = ""
    lastNodeSequenceId: int = 0
    flightStatus: str = "IDLE"
    verticalSpeed: float = 0.0
    agvPosition: AgvPosition | None = None
    batteryState: BatteryState | None = None
    actionStates: list[ActionState] = Field(default_factory=list)


class Visualization(_Header):
    model_config = ConfigDict(extra="allow")
    agvPosition: AgvPosition | None = None
