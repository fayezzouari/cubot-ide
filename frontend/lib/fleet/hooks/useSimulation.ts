'use client';

import { useEffect, useRef, useState } from 'react';
import type { Point, Robot, Task } from '../types';
import type { RobotRoute } from '../simRoutes';
import { DEFAULT_SIM_SPEED, MIN_GAP, SEP_RADIUS, SEP_WEIGHT } from '../constants';

interface Walk {
  robot: Robot;
  points: Point[];
  cum: number[];
  total: number;
  checkpoints: { dist: number; taskId: string }[];
}

interface Bounds {
  width: number;
  height: number;
}

interface Move {
  robot: Robot;
  x: number;
  y: number;
  heading: number;
  status: Robot['status'];
}

function buildWalk(robot: Robot, route: RobotRoute | undefined): Walk {
  const points = route && route.points.length ? route.points : [{ x: robot.position.x, y: robot.position.y }];
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const checkpoints = (route?.checkpoints ?? []).map((c) => ({
    dist: cum[Math.min(c.index, cum.length - 1)],
    taskId: c.taskId,
  }));
  return { robot, points, cum, total: cum[cum.length - 1], checkpoints };
}

function pointAt(walk: Walk, d: number): Point {
  const { points, cum, total } = walk;
  if (points.length === 1 || d <= 0) return points[0];
  if (d >= total) return points[points.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < d) i += 1;
  const a = points[i - 1];
  const b = points[i];
  const span = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function useSimulation(
  baseRobots: Robot[],
  baseTasks: Task[],
  routes: Record<string, RobotRoute>,
  running: boolean,
  bounds: Bounds,
  speedMultiplier: number = DEFAULT_SIM_SPEED,
  onSequenceTaskComplete?: (task: Task) => void,
) {
  const [robots, setRobots] = useState<Robot[]>(baseRobots);
  const [tasks, setTasks] = useState<Task[]>(baseTasks);

  const onSequenceTaskCompleteRef = useRef(onSequenceTaskComplete);
  onSequenceTaskCompleteRef.current = onSequenceTaskComplete;
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  const robotsRef = useRef(baseRobots);
  robotsRef.current = baseRobots;
  const tasksRef = useRef(baseTasks);
  tasksRef.current = baseTasks;
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const frame = useRef<number | null>(null);
  const pos = useRef<Map<string, Point>>(new Map());
  const carrot = useRef<Map<string, number>>(new Map());
  const done = useRef<Set<string>>(new Set());
  const lastRoutes = useRef(routes);

  useEffect(() => {
    if (!running) {
      setRobots(baseRobots.map((r) => ({ ...r, position: { ...r.position } })));
      setTasks(baseTasks.map((t) => ({ ...t })));
    }
  }, [running, baseRobots, baseTasks]);

  useEffect(() => {
    if (!running) return;

    pos.current = new Map(robotsRef.current.map((r) => [r.id, { x: r.position.x, y: r.position.y }]));
    carrot.current = new Map(robotsRef.current.map((r) => [r.id, 0]));
    done.current = new Set();
    lastRoutes.current = routesRef.current;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const baseR = robotsRef.current;
      const baseT = tasksRef.current;
      const rts = routesRef.current;
      const maxX = Math.max(0, boundsRef.current.width - 1);
      const maxY = Math.max(0, boundsRef.current.height - 1);

      if (rts !== lastRoutes.current) {
        lastRoutes.current = rts;
        for (const r of baseR) carrot.current.set(r.id, 0);
      }
      for (const r of baseR) {
        if (!pos.current.has(r.id)) {
          pos.current.set(r.id, { x: r.position.x, y: r.position.y });
          carrot.current.set(r.id, 0);
        }
      }

      const walks = baseR.map((r) => buildWalk(r, rts[r.id]));
      const snapshot = new Map(pos.current);

      const moves: Move[] = walks.map((w) => {
        const id = w.robot.id;
        const cur = snapshot.get(id) ?? { x: w.points[0].x, y: w.points[0].y };
        const speed = Math.max(0.5, w.robot.speed) * speedRef.current;

        if (w.total <= 1e-6) {
          return { robot: w.robot, x: cur.x, y: cur.y, heading: w.robot.heading, status: 'idle' };
        }

        const cd = Math.min((carrot.current.get(id) ?? 0) + speed * dt, w.total);
        carrot.current.set(id, cd);
        for (const cp of w.checkpoints) {
          if (cd < cp.dist || done.current.has(cp.taskId)) continue;
          done.current.add(cp.taskId);
          const task = baseT.find((t) => t.id === cp.taskId);
          if (task && task.sequence_index !== null) {
            onSequenceTaskCompleteRef.current?.(task);
          }
        }

        const target = pointAt(w, cd);
        let vx = target.x - cur.x;
        let vy = target.y - cur.y;
        const seekLen = Math.hypot(vx, vy);
        if (seekLen > 1e-4) {
          vx /= seekLen;
          vy /= seekLen;
        } else {
          vx = 0;
          vy = 0;
        }

        let sx = 0;
        let sy = 0;
        for (const other of walks) {
          if (other.robot.id === id) continue;
          const o = snapshot.get(other.robot.id);
          if (!o) continue;
          const dx = cur.x - o.x;
          const dy = cur.y - o.y;
          const dd = Math.hypot(dx, dy);
          if (dd < SEP_RADIUS && dd > 1e-4) {
            const f = (SEP_RADIUS - dd) / SEP_RADIUS;
            sx += (dx / dd) * f * f;
            sy += (dy / dd) * f * f;
          }
        }

        vx += sx * SEP_WEIGHT;
        vy += sy * SEP_WEIGHT;
        const len = Math.hypot(vx, vy);
        const arrived = cd >= w.total && seekLen < 0.25;
        let nx = cur.x;
        let ny = cur.y;
        if (len > 1e-4 && !(arrived && sx === 0 && sy === 0)) {
          const step = speed * dt;
          nx = cur.x + (vx / len) * step;
          ny = cur.y + (vy / len) * step;
        }

        const heading = len > 1e-4 ? Math.atan2(vy, vx) : w.robot.heading;
        return { robot: w.robot, x: nx, y: ny, heading, status: arrived ? 'working' : 'moving' };
      });

      for (let iter = 0; iter < 3; iter += 1) {
        let moved = false;
        for (let i = 0; i < moves.length; i += 1) {
          for (let j = i + 1; j < moves.length; j += 1) {
            const a = moves[i];
            const b = moves[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dd = Math.hypot(dx, dy);
            if (dd >= MIN_GAP) continue;
            if (dd < 1e-4) {
              dx = i - j || 1;
              dy = 0;
              dd = Math.abs(dx);
            }
            const push = (MIN_GAP - dd) / 2;
            const ux = dx / dd;
            const uy = dy / dd;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
            moved = true;
          }
        }
        if (!moved) break;
      }

      const nextRobots = moves.map((m) => {
        const nx = Math.max(0, Math.min(maxX, m.x));
        const ny = Math.max(0, Math.min(maxY, m.y));
        pos.current.set(m.robot.id, { x: nx, y: ny });
        return { ...m.robot, position: { ...m.robot.position, x: nx, y: ny }, heading: m.heading, status: m.status };
      });

      setRobots(nextRobots);
      setTasks(baseT.map((t) => (done.current.has(t.id) ? { ...t, status: 'done' } : { ...t })));
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [running]);

  return { robots, tasks };
}
