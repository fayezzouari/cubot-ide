from enum import Enum

from pydantic import BaseModel, Field

from schemas.fleet.common import Vec3


class Algorithm(str, Enum):
    astar = "astar"
    dijkstra = "dijkstra"
    rrt = "rrt"
    rrt_star = "rrt_star"
    theta_star = "theta_star"


class Point(BaseModel):
    x: int
    y: int


class PlanRequest(BaseModel):
    grid: list[list[int]]
    start: Point
    goal: Point
    algorithm: Algorithm


class PlanResponse(BaseModel):
    path: list[Point]
    explored: list[Point]
    algorithm: Algorithm
    cost: float


class RoutePoint(BaseModel):
    x: float
    y: float


class RouteRobot(BaseModel):
    id: str
    position: Vec3 = Field(default_factory=Vec3)


class RouteTask(BaseModel):
    id: str
    position: Vec3 = Field(default_factory=Vec3)
    priority: int = 1
    assigned_robot_id: str | None = None
    status: str = "pending"


class PlanRoutesRequest(BaseModel):
    width: int
    height: int
    obstacles: list[list[int]]
    robots: list[RouteRobot]
    tasks: list[RouteTask]
    algorithm: Algorithm = Algorithm.astar


class RouteCheckpoint(BaseModel):
    index: int
    task_id: str


class RobotRoute(BaseModel):
    robot_id: str
    points: list[RoutePoint]
    checkpoints: list[RouteCheckpoint]


class PlanRoutesResponse(BaseModel):
    routes: list[RobotRoute]


class Point3D(BaseModel):
    x: int
    y: int
    z: int


class DronePlanRequest(BaseModel):
    obstacles: list[list[int]]
    depth: int = Field(ge=1, le=200)
    start: Point3D
    goal: Point3D


class DronePlanResponse(BaseModel):
    path: list[Point3D]
    explored: list[Point3D]
    cost: float
