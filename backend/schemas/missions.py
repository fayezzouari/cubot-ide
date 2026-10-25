from datetime import datetime
from typing import List, Literal, Optional, Union

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


ScenarioStep = Union[AnalogStep, DigitalStep, SerialStep]


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


MissionCheck = Union[PinTogglesCheck, PinStateCheck, SerialContainsCheck]


class MissionSummary(BaseModel):
    id: str
    order: int
    track: str
    title: str
    summary: str
    difficulty: Literal["beginner", "intermediate", "advanced"]
    concepts: List[str] = []
    status: Literal["new", "started", "passed"] = "new"
    project_id: Optional[str] = None


class Mission(MissionSummary):
    brief: str
    goal: str
    duration_ms: int = Field(..., gt=0, le=15000)
    starter_files: List[StarterFile]
    scenario: List[ScenarioStep] = []
    checks: List[MissionCheck]
    hints: List[str] = []


class CheckRequest(BaseModel):
    hex: str = Field(..., min_length=1)
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
