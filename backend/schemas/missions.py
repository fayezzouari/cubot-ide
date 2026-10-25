from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


class StarterFile(BaseModel):
    path: str
    content: str


class AnalogStep(BaseModel):
    at_ms: int = Field(..., ge=0)
    action: Literal["analog"] = "analog"
    channel: int = Field(..., ge=0, le=5)
    millivolts: int = Field(..., ge=0, le=5000)


class DigitalStep(BaseModel):
    at_ms: int = Field(..., ge=0)
    action: Literal["digital"] = "digital"
    pin: int = Field(..., ge=0, le=13)
    value: bool


class SerialStep(BaseModel):
    at_ms: int = Field(..., ge=0)
    action: Literal["serial"] = "serial"
    data: str


class PublishStep(BaseModel):
    at_ms: int = Field(..., ge=0)
    action: Literal["publish"] = "publish"
    topic: str
    msg_type: str = Field(..., description="Interface name, e.g. std_msgs/msg/Int32")
    data: Dict[str, Any] = {}


class CallStep(BaseModel):
    at_ms: int = Field(..., ge=0)
    action: Literal["call"] = "call"
    id: str
    service: str
    srv_type: str = Field(..., description="Interface name, e.g. std_srvs/srv/SetBool")
    request: Dict[str, Any] = {}


ScenarioStep = Union[AnalogStep, DigitalStep, SerialStep, PublishStep, CallStep]


class PinTogglesCheck(BaseModel):
    id: str
    label: str
    type: Literal["pin_toggles"] = "pin_toggles"
    pin: int = Field(..., ge=0, le=13)
    interval_ms: int = Field(..., gt=0)
    tolerance: float = Field(default=0.15, gt=0, lt=1)
    min_edges: int = Field(default=4, ge=2)
    after_ms: int = Field(default=0, ge=0)


class PinStateCheck(BaseModel):
    id: str
    label: str
    type: Literal["pin_state"] = "pin_state"
    pin: int = Field(..., ge=0, le=13)
    at_ms: int = Field(..., ge=0)
    value: bool


class SerialContainsCheck(BaseModel):
    id: str
    label: str
    type: Literal["serial_contains"] = "serial_contains"
    text: str
    after_ms: int = Field(default=0, ge=0)
    before_ms: Optional[int] = Field(default=None, ge=0)
    absent: bool = Field(default=False, description="Pass when the text does not appear")


class TopicPublishedCheck(BaseModel):
    id: str
    label: str
    type: Literal["topic_published"] = "topic_published"
    topic: str
    msg_type: str
    min_count: int = Field(default=1, ge=1)
    after_ms: int = Field(default=0, ge=0)
    before_ms: Optional[int] = Field(default=None, ge=0)
    field: Optional[str] = Field(default=None, description="Dotted path into the message, e.g. linear.x")
    contains: Optional[str] = Field(default=None, description="Only count messages whose field contains this text")
    rate_hz: Optional[float] = Field(default=None, gt=0)
    tolerance: float = Field(default=0.25, gt=0, lt=1)


class TopicValueCheck(BaseModel):
    id: str
    label: str
    type: Literal["topic_value"] = "topic_value"
    topic: str
    msg_type: str
    field: str
    equals: Any
    at_ms: int = Field(..., ge=0, description="Look at the latest message received up to this time")
    after_ms: int = Field(default=0, ge=0, description="Ignore messages received before this time")
    tolerance: Optional[float] = Field(default=None, ge=0, description="Absolute tolerance for numbers")


class ServiceResponseCheck(BaseModel):
    id: str
    label: str
    type: Literal["service_response"] = "service_response"
    call: str = Field(..., description="Id of the call step in the scenario")
    field: str
    equals: Any


class NodeRunningCheck(BaseModel):
    id: str
    label: str
    type: Literal["node_running"] = "node_running"
    name: str


MissionCheck = Union[
    PinTogglesCheck, PinStateCheck, SerialContainsCheck,
    TopicPublishedCheck, TopicValueCheck, ServiceResponseCheck, NodeRunningCheck,
]


class MissionSummary(BaseModel):
    id: str
    order: int
    track: str
    title: str
    summary: str
    difficulty: Literal["beginner", "intermediate", "advanced"]
    kind: Literal["arduino", "ros2"] = "arduino"
    concepts: List[str] = []
    status: Literal["new", "started", "passed"] = "new"
    project_id: Optional[str] = None


class Mission(MissionSummary):
    brief: str
    goal: str
    duration_ms: int = Field(..., gt=0, le=15000)
    starter_files: List[StarterFile]
    run: List[str] = Field(default=[], description="Commands that start the learner's ROS 2 nodes")
    scenario: List[ScenarioStep] = []
    checks: List[MissionCheck]
    hints: List[str] = []


class CheckRequest(BaseModel):
    hex: Optional[str] = Field(default=None, min_length=1)
    project_id: Optional[str] = None


class CheckResult(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str


class MissionRun(BaseModel):
    mission_id: str
    passed: bool
    results: List[CheckResult]
    serial: str
    duration_ms: int
    sim_clock: bool = Field(..., description="Timing came from the simulator's own clock")
    error: Optional[str] = None


class MissionStart(BaseModel):
    project_id: str
    created: bool


class ProgressEntry(BaseModel):
    mission_id: str
    status: Literal["started", "passed"]
    project_id: Optional[str] = None
    attempts: int = 0
    passed_at: Optional[datetime] = None
