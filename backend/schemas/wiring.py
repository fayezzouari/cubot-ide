from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class WiringConnection(BaseModel):
    from_: str = Field(..., alias="from")
    to: str
    color: str
    note: str

    model_config = ConfigDict(populate_by_name=True)


class DetectedComponent(BaseModel):
    name: str
    type: str
    connections: List[WiringConnection] = []
    notes: List[str] = []
    pins: List[str] = []


class WiringGuide(BaseModel):
    components: List[DetectedComponent]
    power: List[WiringConnection] = []
    warnings: List[str] = []
    summary: str = ""
    explanation: Optional[str] = None


class WiringRequest(BaseModel):
    source_code: str
    compiler: Optional[str] = None


class WiringResponse(BaseModel):
    guide: WiringGuide
    llm_generated: bool
