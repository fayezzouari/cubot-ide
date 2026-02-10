"""
Schemas for custom sensors and actuators
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from enum import Enum


class ComponentType(str, Enum):
    SENSOR = "sensor"
    ACTUATOR = "actuator"


class PinType(str, Enum):
    DIGITAL = "digital"
    ANALOG = "analog"
    PWM = "pwm"
    I2C = "i2c"
    SPI = "spi"
    SERIAL = "serial"


class PinDefinition(BaseModel):
    name: str
    pin_type: PinType
    description: Optional[str] = None
    default_value: Optional[Any] = None


class ComponentScript(BaseModel):
    """User-defined component behavior script"""
    language: str = "python"  # python or javascript
    code: str
    entry_point: str = "main"  # Function to call


class ComponentCreate(BaseModel):
    name: str
    component_type: ComponentType
    description: Optional[str] = None
    pins: List[PinDefinition]
    script: ComponentScript
    icon: Optional[str] = None  # SVG or icon name
    properties: Dict[str, Any] = Field(default_factory=dict)  # Custom properties


class ComponentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    pins: Optional[List[PinDefinition]] = None
    script: Optional[ComponentScript] = None
    icon: Optional[str] = None
    properties: Optional[Dict[str, Any]] = None


class ComponentResponse(BaseModel):
    id: str
    user_id: str
    name: str
    component_type: ComponentType
    description: Optional[str] = None
    pins: List[PinDefinition]
    script: ComponentScript
    icon: Optional[str] = None
    properties: Dict[str, Any]
    created_at: str
    updated_at: str


class SimulationComponentInstance(BaseModel):
    """Instance of a component in a simulation"""
    instance_id: str
    component_id: str
    position: Dict[str, float]  # x, y for 2D canvas
    rotation: float = 0
    pin_connections: Dict[str, str] = Field(default_factory=dict)  # pin_name -> arduino_pin
    state: Dict[str, Any] = Field(default_factory=dict)  # Runtime state


class SimulationConfig(BaseModel):
    """Configuration for a simulation session"""
    arduino_code: str
    components: List[SimulationComponentInstance]
    wiring: List[Dict[str, str]]  # Connection definitions
    duration: Optional[int] = None  # Max simulation time in seconds
