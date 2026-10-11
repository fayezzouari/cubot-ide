from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Vec3 = list[float]
ExportFormat = Literal["step", "stl", "3mf", "glb", "stl-zip", "urdf"]


# A screenshot of the user's viewport (data URL or bare base64, PNG/JPEG/WebP), ~3 MB max.
ViewImage = Optional[str]
VIEW_IMAGE_MAX = 4_000_000


class GenerateRequest(BaseModel):
    """Create new parts from a prompt and add them to the assembly."""
    prompt: str = Field(min_length=1, max_length=4000)
    view_image: ViewImage = Field(default=None, max_length=VIEW_IMAGE_MAX)


class FaceRef(BaseModel):
    id: int
    type: Optional[str] = None
    center: Optional[Vec3] = None
    normal: Optional[Vec3] = None
    area: Optional[float] = None


class EditRequest(BaseModel):
    """Change one part with a prompt, optionally about a selected face."""
    instruction: str = Field(min_length=1, max_length=4000)
    face: Optional[FaceRef] = None
    view_image: ViewImage = Field(default=None, max_length=VIEW_IMAGE_MAX)


class ParamsRequest(BaseModel):
    params: dict[str, Any]


class CodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=200_000)


class RevertRequest(BaseModel):
    version_id: str


class PartUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class Instance(BaseModel):
    id: str
    part_id: str
    name: str = Field(max_length=120)
    position: Vec3 = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation: Vec3 = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    visible: bool = True
    # How the copy is placed: a mate to another port, a face attachment, or neither (placed by hand).
    mate: Optional[dict[str, Any]] = None
    attach: Optional[dict[str, Any]] = None


class AssemblyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    instances: list[Instance]


class ExportRequest(BaseModel):
    format: ExportFormat
    instance_ids: Optional[list[str]] = None  # default: every visible instance


class SnapshotRequest(BaseModel):
    label: str = Field(default="Snapshot", max_length=120)
