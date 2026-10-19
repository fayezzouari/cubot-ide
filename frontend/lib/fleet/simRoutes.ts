import { fleetApi } from '@/lib/api/fleet';
import type { Algorithm, Drone, Environment, Point, Point3D, Robot, Task } from './types';

export function filterTasksForPlanning(tasks: Task[], robots: Robot[], drones: Drone[]): Task[] {
  const robotById = new Map(robots.map((r) => [r.id, r]));
  const droneById = new Map(drones.map((d) => [d.id, d]));
  return tasks.filter((t) => {
    if (t.sequence_index === null) return true;
    const vehicle = t.assigned_robot_id
      ? robotById.get(t.assigned_robot_id)
      : t.assigned_drone_id
        ? droneById.get(t.assigned_drone_id)
        : undefined;
    if (!vehicle) return false;
    return vehicle.sequence_status === 'running' && t.sequence_index === vehicle.sequence_cursor;
  });
}

export interface RobotRoute {
  robotId: string;
  points: Point[];
  checkpoints: { index: number; taskId: string }[];
}

export async function planRoutes(
  robots: Robot[],
  tasks: Task[],
  env: Environment,
  algorithm: Algorithm,
): Promise<Record<string, RobotRoute>> {
  const res = await fleetApi.planRoutes({
    width: env.width,
    height: env.height,
    obstacles: env.obstacles,
    algorithm,
    robots: robots.map((r) => ({ id: r.id, position: r.position })),
    tasks: tasks.map((t) => ({
      id: t.id,
      position: t.position,
      priority: t.priority,
      assigned_robot_id: t.assigned_robot_id,
      status: t.status,
    })),
  });

  const routes: Record<string, RobotRoute> = {};
  for (const route of res.routes) {
    routes[route.robot_id] = {
      robotId: route.robot_id,
      points: route.points,
      checkpoints: route.checkpoints.map((c) => ({ index: c.index, taskId: c.task_id })),
    };
  }
  return routes;
}

export interface DroneRoute {
  droneId: string;
  points: Point3D[];
  taskId: string;
}

export async function planDroneRoutes(
  drones: Drone[],
  tasks: Task[],
  env: Environment,
): Promise<Record<string, DroneRoute>> {
  const routes: Record<string, DroneRoute> = {};
  await Promise.all(
    drones.map(async (drone) => {
      const task = tasks.find((t) => t.assigned_drone_id === drone.id && t.status !== 'done');
      if (!task) return;
      const res = await fleetApi.planDroneRoute({
        obstacles: env.obstacles,
        depth: Math.max(env.depth, Math.round(drone.position.z) + 1, Math.round(task.position.z) + 1),
        start: {
          x: Math.round(drone.position.x),
          y: Math.round(drone.position.y),
          z: Math.round(drone.position.z),
        },
        goal: {
          x: Math.round(task.position.x),
          y: Math.round(task.position.y),
          z: Math.round(task.position.z),
        },
      });
      if (res.path.length > 1) {
        routes[drone.id] = { droneId: drone.id, points: res.path, taskId: task.id };
      }
    }),
  );
  return routes;
}
