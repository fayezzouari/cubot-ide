'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  fleetApi,
  type CategoryCreate,
  type CategoryUpdate,
  type DroneCreate,
  type DroneUpdate,
  type EnvironmentUpdate,
  type RobotCreate,
  type RobotUpdate,
  type SequenceVehicle,
  type TaskCreate,
  type TaskUpdate,
} from '@/lib/api/fleet';
import type { Category, Drone, Environment, FleetProject, Robot, Task } from '../types';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function guarded<A extends unknown[]>(label: string, fn: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      toast.error(`${label}: ${errorMessage(err)}`);
    }
  };
}

export function useProjectData(projectId: string) {
  const [project, setProject] = useState<FleetProject | null>(null);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const p = await fleetApi.getProject(projectId);
      const [r, d, t, c, e] = await Promise.all([
        fleetApi.listRobots(projectId),
        fleetApi.listDrones(projectId),
        fleetApi.listTasks(projectId),
        fleetApi.listCategories(projectId),
        fleetApi.getEnvironment(projectId),
      ]);
      setProject(p);
      setRobots(r);
      setDrones(d);
      setTasks(t);
      setCategories(c);
      setEnvironment(e);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(() => {
      fleetApi.listTasks(projectId).then(setTasks).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [projectId]);

  const refreshTasks = useCallback(async () => {
    setTasks(await fleetApi.listTasks(projectId));
  }, [projectId]);

  const refreshRobots = useCallback(async () => {
    if (!projectId) return;
    try {
      setRobots(await fleetApi.listRobots(projectId));
    } catch {}
  }, [projectId]);

  const addRobot = useCallback(
    (body: RobotCreate) =>
      guarded('Could not add robot', async () => {
        const created = await fleetApi.createRobot(projectId, body);
        setRobots((prev) => [...prev, created]);
      })(),
    [projectId],
  );
  const editRobot = useCallback(
    (id: string, body: RobotUpdate) =>
      guarded('Could not update robot', async () => {
        const updated = await fleetApi.updateRobot(projectId, id, body);
        setRobots((prev) => prev.map((r) => (r.id === id ? updated : r)));
      })(),
    [projectId],
  );
  const removeRobot = useCallback(
    (id: string) =>
      guarded('Could not delete robot', async () => {
        await fleetApi.deleteRobot(projectId, id);
        setRobots((prev) => prev.filter((r) => r.id !== id));
        await refreshTasks();
      })(),
    [projectId, refreshTasks],
  );

  const addDrone = useCallback(
    (body: DroneCreate) =>
      guarded('Could not add drone', async () => {
        const created = await fleetApi.createDrone(projectId, body);
        setDrones((prev) => [...prev, created]);
      })(),
    [projectId],
  );
  const editDrone = useCallback(
    (id: string, body: DroneUpdate) =>
      guarded('Could not update drone', async () => {
        const updated = await fleetApi.updateDrone(projectId, id, body);
        setDrones((prev) => prev.map((d) => (d.id === id ? updated : d)));
      })(),
    [projectId],
  );
  const removeDrone = useCallback(
    (id: string) =>
      guarded('Could not delete drone', async () => {
        await fleetApi.deleteDrone(projectId, id);
        setDrones((prev) => prev.filter((d) => d.id !== id));
        await refreshTasks();
      })(),
    [projectId, refreshTasks],
  );

  const addTask = useCallback(
    (body: TaskCreate) =>
      guarded('Could not add task', async () => {
        const created = await fleetApi.createTask(projectId, body);
        setTasks((prev) => [...prev, created]);
      })(),
    [projectId],
  );
  const editTask = useCallback(
    (id: string, body: TaskUpdate) =>
      guarded('Could not update task', async () => {
        const updated = await fleetApi.updateTask(projectId, id, body);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      })(),
    [projectId],
  );
  const removeTask = useCallback(
    (id: string) =>
      guarded('Could not delete task', async () => {
        await fleetApi.deleteTask(projectId, id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
      })(),
    [projectId],
  );
  const reassign = useCallback(
    () =>
      guarded('Could not reassign tasks', async () => {
        await fleetApi.reassignTasks(projectId);
        await refreshTasks();
      })(),
    [projectId, refreshTasks],
  );
  const reassignDrones = useCallback(
    () =>
      guarded('Could not reassign aerial tasks', async () => {
        await fleetApi.reassignDroneTasks(projectId);
        await refreshTasks();
      })(),
    [projectId, refreshTasks],
  );

  const applyVehicleUpdate = useCallback((kind: SequenceVehicle, updated: Robot | Drone) => {
    if (kind === 'robots') {
      setRobots((prev) => prev.map((r) => (r.id === updated.id ? (updated as Robot) : r)));
    } else {
      setDrones((prev) => prev.map((d) => (d.id === updated.id ? (updated as Drone) : d)));
    }
  }, []);

  const sequenceAction = useCallback(
    (label: string, call: typeof fleetApi.startSequence) => (kind: SequenceVehicle, vehicleId: string) =>
      guarded(label, async () => {
        const updated = await call(projectId, kind, vehicleId);
        applyVehicleUpdate(kind, updated);
        await refreshTasks();
      })(),
    [projectId, applyVehicleUpdate, refreshTasks],
  );

  const startSequence = useCallback(
    (kind: SequenceVehicle, vehicleId: string) =>
      sequenceAction('Could not start sequence', fleetApi.startSequence)(kind, vehicleId),
    [sequenceAction],
  );
  const completeSequenceTask = useCallback(
    (kind: SequenceVehicle, vehicleId: string) =>
      sequenceAction('Could not complete sequence task', fleetApi.completeSequenceTask)(kind, vehicleId),
    [sequenceAction],
  );
  const advanceSequence = useCallback(
    (kind: SequenceVehicle, vehicleId: string) =>
      sequenceAction('Could not advance sequence', fleetApi.advanceSequence)(kind, vehicleId),
    [sequenceAction],
  );
  const stopSequence = useCallback(
    (kind: SequenceVehicle, vehicleId: string) =>
      sequenceAction('Could not stop sequence', fleetApi.stopSequence)(kind, vehicleId),
    [sequenceAction],
  );

  const addCategory = useCallback(
    (body: CategoryCreate) =>
      guarded('Could not add category', async () => {
        const created = await fleetApi.createCategory(projectId, body);
        setCategories((prev) => [...prev, created]);
      })(),
    [projectId],
  );
  const editCategory = useCallback(
    (id: string, body: CategoryUpdate) =>
      guarded('Could not update category', async () => {
        const updated = await fleetApi.updateCategory(projectId, id, body);
        setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
      })(),
    [projectId],
  );
  const removeCategory = useCallback(
    (id: string) =>
      guarded('Could not delete category', async () => {
        await fleetApi.deleteCategory(projectId, id);
        setCategories((prev) => prev.filter((c) => c.id !== id));
        const [t, r, d] = await Promise.all([
          fleetApi.listTasks(projectId),
          fleetApi.listRobots(projectId),
          fleetApi.listDrones(projectId),
        ]);
        setTasks(t);
        setRobots(r);
        setDrones(d);
      })(),
    [projectId],
  );

  const applyAssignment = useCallback((taskId: string, robotId: string | null, etaS: number | null) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              assigned_robot_id: robotId,
              eta_s: etaS,
              status: t.status === 'done' ? 'done' : robotId ? 'assigned' : 'pending',
            }
          : t,
      ),
    );
  }, []);

  const saveEnvironment = useCallback(
    (body: EnvironmentUpdate) =>
      guarded('Could not save environment', async () => {
        setEnvironment(await fleetApi.updateEnvironment(projectId, body));
      })(),
    [projectId],
  );

  const obstacleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleObstacle = useCallback(
    (x: number, y: number) => {
      setEnvironment((prev) => {
        if (!prev) return prev;
        const h = prev.obstacles.length;
        const w = h ? prev.obstacles[0].length : 0;
        if (y < 0 || y >= h || x < 0 || x >= w) return prev;
        const obstacles = prev.obstacles.map((row) => [...row]);
        obstacles[y][x] = obstacles[y][x] ? 0 : 1;
        if (obstacleTimer.current) clearTimeout(obstacleTimer.current);
        obstacleTimer.current = setTimeout(() => {
          fleetApi.updateEnvironment(projectId, { obstacles }).catch((err: unknown) => {
            toast.error(`Could not save obstacles: ${errorMessage(err)}`);
          });
        }, 400);
        return { ...prev, obstacles };
      });
    },
    [projectId],
  );

  return {
    project,
    robots,
    drones,
    tasks,
    categories,
    environment,
    loading,
    error,
    reload,
    refreshRobots,
    addRobot,
    editRobot,
    removeRobot,
    addDrone,
    editDrone,
    removeDrone,
    addTask,
    editTask,
    removeTask,
    reassign,
    reassignDrones,
    startSequence,
    completeSequenceTask,
    advanceSequence,
    stopSequence,
    addCategory,
    editCategory,
    removeCategory,
    applyAssignment,
    saveEnvironment,
    toggleObstacle,
  };
}
