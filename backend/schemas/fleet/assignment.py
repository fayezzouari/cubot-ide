from pydantic import BaseModel


class Assignment(BaseModel):
    task_id: str
    robot_id: str | None = None
    distance: float | None = None


class AssignmentResult(BaseModel):
    assignments: list[Assignment]


class DroneAssignment(BaseModel):
    task_id: str
    drone_id: str | None = None
    distance: float | None = None


class DroneAssignmentResult(BaseModel):
    assignments: list[DroneAssignment]
