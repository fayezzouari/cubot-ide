'use client';

import { useEffect, useRef, useState } from 'react';
import type { Drone, Point3D, Task } from '../types';
import type { DroneRoute } from '../simRoutes';
import { DEFAULT_SIM_SPEED } from '../constants';

interface Walk {
  drone: Drone;
  points: Point3D[];
  cum: number[];
  total: number;
  taskId: string | null;
}

function dist3(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function buildWalk(drone: Drone, route: DroneRoute | undefined): Walk {
  const points = route && route.points.length ? route.points : [{ ...drone.position }];
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1] + dist3(points[i], points[i - 1]));
  }
  return { drone, points, cum, total: cum[cum.length - 1], taskId: route?.taskId ?? null };
}

function pointAt(walk: Walk, d: number): Point3D {
  const { points, cum, total } = walk;
  if (points.length === 1 || d <= 0) return points[0];
  if (d >= total) return points[points.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < d) i += 1;
  const a = points[i - 1];
  const b = points[i];
  const span = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function useDroneSimulation(
  baseDrones: Drone[],
  baseTasks: Task[],
  routes: Record<string, DroneRoute>,
  running: boolean,
  speedMultiplier: number = DEFAULT_SIM_SPEED,
  onSequenceTaskComplete?: (task: Task) => void,
) {
  const [drones, setDrones] = useState<Drone[]>(baseDrones);
  const [tasks, setTasks] = useState<Task[]>(baseTasks);

  const onSequenceTaskCompleteRef = useRef(onSequenceTaskComplete);
  onSequenceTaskCompleteRef.current = onSequenceTaskComplete;
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  const dronesRef = useRef(baseDrones);
  dronesRef.current = baseDrones;
  const tasksRef = useRef(baseTasks);
  tasksRef.current = baseTasks;
  const routesRef = useRef(routes);
  routesRef.current = routes;

  const frame = useRef<number | null>(null);
  const pos = useRef<Map<string, Point3D>>(new Map());
  const carrot = useRef<Map<string, number>>(new Map());
  const done = useRef<Set<string>>(new Set());
  const lastRoutes = useRef(routes);

  useEffect(() => {
    if (!running) {
      setDrones(baseDrones.map((d) => ({ ...d, position: { ...d.position } })));
      setTasks(baseTasks.map((t) => ({ ...t })));
    }
  }, [running, baseDrones, baseTasks]);

  useEffect(() => {
    if (!running) return;

    pos.current = new Map(dronesRef.current.map((d) => [d.id, { ...d.position }]));
    carrot.current = new Map(dronesRef.current.map((d) => [d.id, 0]));
    done.current = new Set();
    lastRoutes.current = routesRef.current;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const baseD = dronesRef.current;
      const baseT = tasksRef.current;
      const rts = routesRef.current;

      if (rts !== lastRoutes.current) {
        lastRoutes.current = rts;
        for (const d of baseD) carrot.current.set(d.id, 0);
      }
      for (const d of baseD) {
        if (!pos.current.has(d.id)) {
          pos.current.set(d.id, { ...d.position });
          carrot.current.set(d.id, 0);
        }
      }

      const walks = baseD.map((d) => buildWalk(d, rts[d.id]));

      const nextDrones = walks.map((w) => {
        const id = w.drone.id;
        const cur = pos.current.get(id) ?? w.points[0];
        const speed = Math.max(0.5, w.drone.speed) * speedRef.current;

        if (w.total <= 1e-6) {
          return { ...w.drone, position: cur, status: 'idle' as Drone['status'] };
        }

        const cd = Math.min((carrot.current.get(id) ?? 0) + speed * dt, w.total);
        carrot.current.set(id, cd);
        const arrived = cd >= w.total;
        if (arrived && w.taskId && !done.current.has(w.taskId)) {
          done.current.add(w.taskId);
          const task = baseT.find((t) => t.id === w.taskId);
          if (task && task.sequence_index !== null) {
            onSequenceTaskCompleteRef.current?.(task);
          }
        }

        const target = pointAt(w, cd);
        pos.current.set(id, target);
        const status: Drone['status'] = arrived ? 'hovering' : 'flying';
        return { ...w.drone, position: target, status };
      });

      setDrones(nextDrones);
      setTasks(baseT.map((t) => (done.current.has(t.id) ? { ...t, status: 'done' } : { ...t })));
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [running]);

  return { drones, tasks };
}
