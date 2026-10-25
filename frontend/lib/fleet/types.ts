export type Dimension = '2d' | '3d';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RobotStatus = 'idle' | 'moving' | 'working';
export type DroneStatus = 'idle' | 'flying' | 'hovering' | 'charging' | 'working';
export type TaskStatus = 'pending' | 'assigned' | 'done';
export type VehicleKind = 'ground' | 'aerial';

export type SequenceMode = 'auto' | 'manual';
export type SequenceStatus = 'idle' | 'running' | 'held' | 'completed';

export interface FleetProject {
  id: string;
  name: string;
  dimension: Dimension;
  description: string;
  created_at: string;
  updated_at: string;
  robot_count: number;
  task_count: number;
}

export interface Robot {
  id: string;
  project_id: string;
  name: string;
  position: Vec3;
  heading: number;
  speed: number;
  color: string;
  category_id: string | null;
  status: RobotStatus;
  serial_number: string;
  manufacturer: string;
  sequence_mode: SequenceMode;
  sequence_status: SequenceStatus;
  sequence_cursor: number;
}

export interface Drone {
  id: string;
  project_id: string;
  name: string;
  position: Vec3;
  heading: number;
  speed: number;
  color: string;
  category_id: string | null;
  status: DroneStatus;
  serial_number: string;
  manufacturer: string;
  sequence_mode: SequenceMode;
  sequence_status: SequenceStatus;
  sequence_cursor: number;
}

export interface Task {
  id: string;
  project_id: string;
  name: string;
  position: Vec3;
  priority: number;
  assigned_robot_id: string | null;
  category_ids: string[];
  status: TaskStatus;
  created_at: string;
  deadline_s?: number | null;
  eta_s?: number | null;
  vehicle_kind: VehicleKind;
  assigned_drone_id: string | null;
  sequence_index: number | null;
}

export interface Category {
  id: string;
  project_id: string;
  name: string;
  color: string;
}

export type BrokerMode = 'simulated' | 'live';

export interface Broker {
  id: string;
  project_id: string;
  name: string;
  status: string;
  mode: BrokerMode;
  dispatch_active: boolean;
  auto_assign: boolean;
  topic_prefix: string;
  ws_url: string;
  created_at: string;
}

export type BackgroundPreset = 'warehouse' | 'blueprint' | 'concrete' | 'hazard' | 'sand';

export interface Environment {
  project_id: string;
  dimension: Dimension;
  width: number;
  height: number;
  depth: number;
  obstacles: number[][];
  background: BackgroundPreset;
}

export interface Assignment {
  task_id: string;
  robot_id: string | null;
  distance: number | null;
}

export interface AssignmentResult {
  assignments: Assignment[];
}

export interface DroneAssignment {
  task_id: string;
  drone_id: string | null;
  distance: number | null;
}

export interface DroneAssignmentResult {
  assignments: DroneAssignment[];
}

export type Algorithm = 'astar' | 'dijkstra' | 'rrt' | 'rrt_star' | 'theta_star';

export interface Point {
  x: number;
  y: number;
}

export interface PlanResponse {
  path: Point[];
  explored: Point[];
  algorithm: Algorithm;
  cost: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface DronePlanResponse {
  path: Point3D[];
  explored: Point3D[];
  cost: number;
}

export type Vda5050Type = 'order' | 'instantActions' | 'state' | 'visualization' | 'connection' | 'factsheet';

export type FlowDir = 'down' | 'up';

export interface TypeMeta {
  dir: FlowDir;
  color: string;
  label: string;
}
