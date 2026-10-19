import { apiClient } from './client';
import type {
  Algorithm,
  AssignmentResult,
  BackgroundPreset,
  Broker,
  BrokerMode,
  Category,
  Dimension,
  Drone,
  DronePlanResponse,
  DroneStatus,
  DroneAssignmentResult,
  Environment,
  FleetProject,
  PlanResponse,
  Point,
  Point3D,
  Robot,
  RobotStatus,
  SequenceMode,
  Task,
  TaskStatus,
  Vec3,
  VehicleKind,
} from '@/lib/fleet/types';

export interface RobotCreate {
  name: string;
  position?: Vec3;
  heading?: number;
  speed?: number;
  color?: string;
  category_id?: string | null;
}

export interface RobotUpdate {
  name?: string;
  position?: Vec3;
  heading?: number;
  speed?: number;
  color?: string;
  category_id?: string | null;
  status?: RobotStatus;
  sequence_mode?: SequenceMode;
}

export interface DroneCreate {
  name: string;
  position?: Vec3;
  heading?: number;
  speed?: number;
  color?: string;
  category_id?: string | null;
}

export interface DroneUpdate {
  name?: string;
  position?: Vec3;
  heading?: number;
  speed?: number;
  color?: string;
  category_id?: string | null;
  status?: DroneStatus;
  sequence_mode?: SequenceMode;
}

export interface TaskCreate {
  name: string;
  position?: Vec3;
  priority?: number;
  assigned_robot_id?: string | null;
  category_ids?: string[];
  deadline_s?: number | null;
  vehicle_kind?: VehicleKind;
  assigned_drone_id?: string | null;
}

export interface TaskUpdate {
  name?: string;
  position?: Vec3;
  priority?: number;
  assigned_robot_id?: string | null;
  category_ids?: string[];
  status?: TaskStatus;
  deadline_s?: number | null;
  vehicle_kind?: VehicleKind;
  assigned_drone_id?: string | null;
}

export interface CategoryCreate {
  name: string;
  color?: string;
}

export interface CategoryUpdate {
  name?: string;
  color?: string;
}

export interface EnvironmentUpdate {
  width?: number;
  height?: number;
  depth?: number;
  obstacles?: number[][];
  background?: BackgroundPreset;
}

export interface BrokerUpdate {
  mode?: BrokerMode;
  dispatch_active?: boolean;
}

export type SequenceVehicle = 'robots' | 'drones';

export interface PlanRoutesRequest {
  width: number;
  height: number;
  obstacles: number[][];
  robots: { id: string; position: Vec3 }[];
  tasks: {
    id: string;
    position: Vec3;
    priority: number;
    assigned_robot_id: string | null;
    status: string;
  }[];
  algorithm: Algorithm;
}

export interface PlanRoutesResponse {
  routes: {
    robot_id: string;
    points: Point[];
    checkpoints: { index: number; task_id: string }[];
  }[];
}

export interface DronePlanRequest {
  obstacles: number[][];
  depth: number;
  start: Point3D;
  goal: Point3D;
}

const project = (id: string) => `/fleet/projects/${id}`;

function sequence<T extends Robot | Drone>(projectId: string, kind: SequenceVehicle, vehicleId: string, step: 'start' | 'advance' | 'complete' | 'stop') {
  return apiClient.post<T>(`${project(projectId)}/${kind}/${vehicleId}/sequence/${step}`);
}

export const fleetApi = {
  getProject: (id: string) => apiClient.get<FleetProject>(project(id)),
  initProject: (id: string, dimension: Dimension) => apiClient.post<FleetProject>(`${project(id)}/init`, { dimension }),

  listRobots: (projectId: string) => apiClient.get<Robot[]>(`${project(projectId)}/robots`),
  createRobot: (projectId: string, body: RobotCreate) => apiClient.post<Robot>(`${project(projectId)}/robots`, body),
  updateRobot: (projectId: string, robotId: string, body: RobotUpdate) =>
    apiClient.put<Robot>(`${project(projectId)}/robots/${robotId}`, body),
  deleteRobot: (projectId: string, robotId: string) => apiClient.delete<void>(`${project(projectId)}/robots/${robotId}`),

  listDrones: (projectId: string) => apiClient.get<Drone[]>(`${project(projectId)}/drones`),
  createDrone: (projectId: string, body: DroneCreate) => apiClient.post<Drone>(`${project(projectId)}/drones`, body),
  updateDrone: (projectId: string, droneId: string, body: DroneUpdate) =>
    apiClient.put<Drone>(`${project(projectId)}/drones/${droneId}`, body),
  deleteDrone: (projectId: string, droneId: string) => apiClient.delete<void>(`${project(projectId)}/drones/${droneId}`),

  listTasks: (projectId: string) => apiClient.get<Task[]>(`${project(projectId)}/tasks`),
  createTask: (projectId: string, body: TaskCreate) => apiClient.post<Task>(`${project(projectId)}/tasks`, body),
  updateTask: (projectId: string, taskId: string, body: TaskUpdate) =>
    apiClient.put<Task>(`${project(projectId)}/tasks/${taskId}`, body),
  deleteTask: (projectId: string, taskId: string) => apiClient.delete<void>(`${project(projectId)}/tasks/${taskId}`),
  reassignTasks: (projectId: string) => apiClient.post<AssignmentResult>(`${project(projectId)}/tasks/reassign`),
  reassignDroneTasks: (projectId: string) => apiClient.post<DroneAssignmentResult>(`${project(projectId)}/tasks/reassign-drones`),

  listCategories: (projectId: string) => apiClient.get<Category[]>(`${project(projectId)}/categories`),
  createCategory: (projectId: string, body: CategoryCreate) => apiClient.post<Category>(`${project(projectId)}/categories`, body),
  updateCategory: (projectId: string, categoryId: string, body: CategoryUpdate) =>
    apiClient.put<Category>(`${project(projectId)}/categories/${categoryId}`, body),
  deleteCategory: (projectId: string, categoryId: string) =>
    apiClient.delete<void>(`${project(projectId)}/categories/${categoryId}`),

  getEnvironment: (projectId: string) => apiClient.get<Environment>(`${project(projectId)}/environment`),
  updateEnvironment: (projectId: string, body: EnvironmentUpdate) =>
    apiClient.put<Environment>(`${project(projectId)}/environment`, body),

  getBroker: (projectId: string) => apiClient.get<Broker>(`${project(projectId)}/broker`),
  createBroker: (projectId: string, name = 'fleet') => apiClient.post<Broker>(`${project(projectId)}/broker`, { name }),
  updateBroker: (projectId: string, changes: BrokerUpdate) => apiClient.put<Broker>(`${project(projectId)}/broker`, changes),
  deleteBroker: (projectId: string) => apiClient.delete<void>(`${project(projectId)}/broker`),

  startSequence: <T extends Robot | Drone>(projectId: string, kind: SequenceVehicle, vehicleId: string) =>
    sequence<T>(projectId, kind, vehicleId, 'start'),
  advanceSequence: <T extends Robot | Drone>(projectId: string, kind: SequenceVehicle, vehicleId: string) =>
    sequence<T>(projectId, kind, vehicleId, 'advance'),
  completeSequenceTask: <T extends Robot | Drone>(projectId: string, kind: SequenceVehicle, vehicleId: string) =>
    sequence<T>(projectId, kind, vehicleId, 'complete'),
  stopSequence: <T extends Robot | Drone>(projectId: string, kind: SequenceVehicle, vehicleId: string) =>
    sequence<T>(projectId, kind, vehicleId, 'stop'),

  runPlan: (grid: number[][], start: Point, goal: Point, algorithm: Algorithm) =>
    apiClient.post<PlanResponse>('/fleet/planning/run', { grid, start, goal, algorithm }),
  planRoutes: (body: PlanRoutesRequest) => apiClient.post<PlanRoutesResponse>('/fleet/planning/routes', body),
  planDroneRoute: (body: DronePlanRequest) => apiClient.post<DronePlanResponse>('/fleet/planning/drone-route', body),
};
