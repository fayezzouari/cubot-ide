from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

BrokerMode = Literal["simulated", "live"]

DEFAULT_BROKER_MODE: BrokerMode = "simulated"

DEFAULT_BROKER_NAME = "fleet"


class BrokerCreate(BaseModel):
    name: str = Field(default=DEFAULT_BROKER_NAME, min_length=1, max_length=80)


class BrokerUpdate(BaseModel):
    mode: BrokerMode | None = None
    dispatch_active: bool | None = None


class BrokerOut(BaseModel):
    id: str
    project_id: str
    name: str
    status: str
    mode: BrokerMode = DEFAULT_BROKER_MODE
    dispatch_active: bool = True
    topic_prefix: str
    ws_url: str
    created_at: datetime
