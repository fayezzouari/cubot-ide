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
    actionParameters: list[dict] | None = None


class NodePosition(BaseModel):
    x: float
    y: float
    mapId: str
    theta: float | None = None
    allowedDeviationXY: float | None = None
    allowedDeviationTheta: float | None = None


class Node(BaseModel):
    nodeId: str
    sequenceId: int
    released: bool
    nodePosition: NodePosition | None = None
    actions: list[Action] = Field(default_factory=list)


class Edge(BaseModel):
    edgeId: str
    sequenceId: int
    released: bool
    startNodeId: str
    endNodeId: str
    maxSpeed: float | None = None
    actions: list[Action] = Field(default_factory=list)


class Order(_Header):
    orderId: str
    orderUpdateId: int
    zoneSetId: str | None = None
    nodes: list[Node]
    edges: list[Edge]


class InstantActions(_Header):
    actions: list[Action]


class Connection(_Header):
    connectionState: str


class AgvPosition(BaseModel):
    model_config = ConfigDict(extra="allow")
    x: float = 0.0
    y: float = 0.0
    theta: float = 0.0
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
    driving: bool = False
    paused: bool | None = None
    operatingMode: str = "AUTOMATIC"
    agvPosition: AgvPosition | None = None
    batteryState: BatteryState | None = None
    actionStates: list[ActionState] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


class Visualization(_Header):
    model_config = ConfigDict(extra="allow")
    agvPosition: AgvPosition | None = None


class PhysicalParameters(BaseModel):
    model_config = ConfigDict(extra="allow")
    speedMin: float | None = None
    speedMax: float | None = None
    accelerationMax: float | None = None
    decelerationMax: float | None = None
    heightMax: float | None = None
    length: float | None = None
    width: float | None = None


class TypeSpecification(BaseModel):
    model_config = ConfigDict(extra="allow")
    seriesName: str | None = None
    agvKinematic: str | None = None
    agvClass: str | None = None
    maxLoadMass: float | None = None


class Factsheet(_Header):
    model_config = ConfigDict(extra="allow")
    typeSpecification: TypeSpecification | None = None
    physicalParameters: PhysicalParameters | None = None
    protocolFeatures: dict | None = None
