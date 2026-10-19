from fastapi import APIRouter, status
from fastapi.concurrency import run_in_threadpool

from core.auth import CurrentUser
from schemas.fleet.assignment import AssignmentResult, DroneAssignmentResult
from schemas.fleet.broker import BrokerCreate, BrokerOut, BrokerUpdate
from schemas.fleet.category import CategoryCreate, CategoryOut, CategoryUpdate
from schemas.fleet.drone import DroneCreate, DroneOut, DroneUpdate
from schemas.fleet.environment import EnvironmentOut, EnvironmentUpdate
from schemas.fleet.planning import (
    DronePlanRequest,
    DronePlanResponse,
    PlanRequest,
    PlanResponse,
    PlanRoutesRequest,
    PlanRoutesResponse,
)
from schemas.fleet.project import ProjectInit, ProjectOut
from schemas.fleet.robot import RobotCreate, RobotOut, RobotUpdate
from schemas.fleet.task import TaskCreate, TaskOut, TaskUpdate
from services.fleet import (
    assignment_service,
    broker_service,
    category_service,
    drone_assignment_service,
    drone_service,
    environment_service,
    planning_service,
    project_service,
    robot_service,
    sequence_service,
    task_service,
)

router = APIRouter(prefix="/fleet", tags=["fleet"])

_P = "/projects/{project_id}"


@router.get(_P, response_model=ProjectOut)
async def get_project(project_id: str, user: CurrentUser):
    return await project_service.get_project(project_id, user["sub"])


@router.post(_P + "/init", response_model=ProjectOut)
async def init_project(project_id: str, body: ProjectInit, user: CurrentUser):
    return await project_service.init_project(project_id, user["sub"], body)


@router.get(_P + "/robots", response_model=list[RobotOut])
async def list_robots(project_id: str, user: CurrentUser):
    return await robot_service.list_robots(project_id, user["sub"])


@router.post(_P + "/robots", response_model=RobotOut, status_code=status.HTTP_201_CREATED)
async def create_robot(project_id: str, body: RobotCreate, user: CurrentUser):
    return await robot_service.create_robot(project_id, user["sub"], body)


@router.patch(_P + "/robots/{robot_id}", response_model=RobotOut)
@router.put(_P + "/robots/{robot_id}", response_model=RobotOut)
async def update_robot(project_id: str, robot_id: str, body: RobotUpdate, user: CurrentUser):
    return await robot_service.update_robot(project_id, robot_id, user["sub"], body)


@router.delete(_P + "/robots/{robot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_robot(project_id: str, robot_id: str, user: CurrentUser):
    await robot_service.delete_robot(project_id, robot_id, user["sub"])


@router.post(_P + "/robots/{robot_id}/sequence/start", response_model=RobotOut)
async def start_robot_sequence(project_id: str, robot_id: str, user: CurrentUser):
    return await sequence_service.start_sequence(project_id, user["sub"], "robot", robot_id)


@router.post(_P + "/robots/{robot_id}/sequence/complete", response_model=RobotOut)
async def complete_robot_sequence(project_id: str, robot_id: str, user: CurrentUser):
    return await sequence_service.complete_current(project_id, user["sub"], "robot", robot_id)


@router.post(_P + "/robots/{robot_id}/sequence/advance", response_model=RobotOut)
async def advance_robot_sequence(project_id: str, robot_id: str, user: CurrentUser):
    return await sequence_service.advance_sequence(project_id, user["sub"], "robot", robot_id)


@router.post(_P + "/robots/{robot_id}/sequence/stop", response_model=RobotOut)
async def stop_robot_sequence(project_id: str, robot_id: str, user: CurrentUser):
    return await sequence_service.stop_sequence(project_id, user["sub"], "robot", robot_id)


@router.get(_P + "/drones", response_model=list[DroneOut])
async def list_drones(project_id: str, user: CurrentUser):
    return await drone_service.list_drones(project_id, user["sub"])


@router.post(_P + "/drones", response_model=DroneOut, status_code=status.HTTP_201_CREATED)
async def create_drone(project_id: str, body: DroneCreate, user: CurrentUser):
    return await drone_service.create_drone(project_id, user["sub"], body)


@router.patch(_P + "/drones/{drone_id}", response_model=DroneOut)
@router.put(_P + "/drones/{drone_id}", response_model=DroneOut)
async def update_drone(project_id: str, drone_id: str, body: DroneUpdate, user: CurrentUser):
    return await drone_service.update_drone(project_id, drone_id, user["sub"], body)


@router.delete(_P + "/drones/{drone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_drone(project_id: str, drone_id: str, user: CurrentUser):
    await drone_service.delete_drone(project_id, drone_id, user["sub"])


@router.post(_P + "/drones/{drone_id}/sequence/start", response_model=DroneOut)
async def start_drone_sequence(project_id: str, drone_id: str, user: CurrentUser):
    return await sequence_service.start_sequence(project_id, user["sub"], "drone", drone_id)


@router.post(_P + "/drones/{drone_id}/sequence/complete", response_model=DroneOut)
async def complete_drone_sequence(project_id: str, drone_id: str, user: CurrentUser):
    return await sequence_service.complete_current(project_id, user["sub"], "drone", drone_id)


@router.post(_P + "/drones/{drone_id}/sequence/advance", response_model=DroneOut)
async def advance_drone_sequence(project_id: str, drone_id: str, user: CurrentUser):
    return await sequence_service.advance_sequence(project_id, user["sub"], "drone", drone_id)


@router.post(_P + "/drones/{drone_id}/sequence/stop", response_model=DroneOut)
async def stop_drone_sequence(project_id: str, drone_id: str, user: CurrentUser):
    return await sequence_service.stop_sequence(project_id, user["sub"], "drone", drone_id)


@router.get(_P + "/tasks", response_model=list[TaskOut])
async def list_tasks(project_id: str, user: CurrentUser):
    return await task_service.list_tasks(project_id, user["sub"])


@router.post(_P + "/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(project_id: str, body: TaskCreate, user: CurrentUser):
    return await task_service.create_task(project_id, user["sub"], body)


@router.post(_P + "/tasks/reassign", response_model=AssignmentResult)
async def reassign(project_id: str, user: CurrentUser):
    return await assignment_service.reassign(project_id, user["sub"])


@router.post(_P + "/tasks/reassign-drones", response_model=DroneAssignmentResult)
async def reassign_drones(project_id: str, user: CurrentUser):
    return await drone_assignment_service.reassign_drones(project_id, user["sub"])


@router.patch(_P + "/tasks/{task_id}", response_model=TaskOut)
@router.put(_P + "/tasks/{task_id}", response_model=TaskOut)
async def update_task(project_id: str, task_id: str, body: TaskUpdate, user: CurrentUser):
    return await task_service.update_task(project_id, task_id, user["sub"], body)


@router.delete(_P + "/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(project_id: str, task_id: str, user: CurrentUser):
    await task_service.delete_task(project_id, task_id, user["sub"])


@router.get(_P + "/categories", response_model=list[CategoryOut])
async def list_categories(project_id: str, user: CurrentUser):
    return await category_service.list_categories(project_id, user["sub"])


@router.post(_P + "/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(project_id: str, body: CategoryCreate, user: CurrentUser):
    return await category_service.create_category(project_id, user["sub"], body)


@router.patch(_P + "/categories/{category_id}", response_model=CategoryOut)
@router.put(_P + "/categories/{category_id}", response_model=CategoryOut)
async def update_category(project_id: str, category_id: str, body: CategoryUpdate, user: CurrentUser):
    return await category_service.update_category(project_id, category_id, user["sub"], body)


@router.delete(_P + "/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(project_id: str, category_id: str, user: CurrentUser):
    await category_service.delete_category(project_id, category_id, user["sub"])


@router.get(_P + "/environment", response_model=EnvironmentOut)
async def get_environment(project_id: str, user: CurrentUser):
    return await environment_service.get_environment(project_id, user["sub"])


@router.put(_P + "/environment", response_model=EnvironmentOut)
async def update_environment(project_id: str, body: EnvironmentUpdate, user: CurrentUser):
    return await environment_service.update_environment(project_id, user["sub"], body)


@router.get(_P + "/broker", response_model=BrokerOut)
async def get_broker(project_id: str, user: CurrentUser):
    return await broker_service.get_broker(project_id, user["sub"])


@router.post(_P + "/broker", response_model=BrokerOut, status_code=status.HTTP_201_CREATED)
async def create_broker(project_id: str, body: BrokerCreate, user: CurrentUser):
    return await broker_service.create_broker(project_id, user["sub"], body)


@router.patch(_P + "/broker", response_model=BrokerOut)
@router.put(_P + "/broker", response_model=BrokerOut)
async def update_broker(project_id: str, body: BrokerUpdate, user: CurrentUser):
    return await broker_service.update_broker(project_id, user["sub"], body)


@router.delete(_P + "/broker", status_code=status.HTTP_204_NO_CONTENT)
async def delete_broker(project_id: str, user: CurrentUser):
    await broker_service.delete_broker(project_id, user["sub"])


@router.post("/planning/run", response_model=PlanResponse)
async def run_planning(req: PlanRequest) -> PlanResponse:
    return await run_in_threadpool(planning_service.run_plan, req)


@router.post("/planning/routes", response_model=PlanRoutesResponse)
async def plan_routes(req: PlanRoutesRequest) -> PlanRoutesResponse:
    return await run_in_threadpool(planning_service.plan_routes, req)


@router.post("/planning/drone-route", response_model=DronePlanResponse)
async def plan_drone_route(req: DronePlanRequest) -> DronePlanResponse:
    return await run_in_threadpool(planning_service.run_drone_plan, req)
