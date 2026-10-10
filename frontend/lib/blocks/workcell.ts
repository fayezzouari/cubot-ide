// Simulated robot workcell.
//
// The stations around the robot come from an editable layout (layout.ts). The
// default layout, top view, mm, robot base at the origin, Y up:
//
//            conveyor (z = 500) ──────────────► end stop / pick point (x = -30)
//
//   machine ▣ fixture (-480, -220)        robot ●          pallet ▦ (480, 150)
//
//        bins:  red (-330)  green (-110)  blue (110)  reject (330)   at z = -480
//
// The world owns all mutable simulation state and advances on `tick`. Motion
// commands return promises that resolve when the move finishes in simulated
// time, so the interpreter reads like a robot program.

import {
  checkLimits,
  forwardKinematics,
  HOME_JOINTS,
  inverseKinematics,
  JOINT_LIMITS,
  UnreachableError,
} from './kinematics';
import {
  cloneLayout,
  CONVEYOR_TOP,
  conveyorEnds,
  DEFAULT_LAYOUT,
  footprint,
  inBox,
  MACHINE_ZONE_FRONT,
  MACHINE_ZONE_HALF_WIDTH,
  PART_SIZE,
  param,
  posesForLayout,
  stationBoxes,
  toLocal,
  toWorld,
  traySlots,
  type CellLayout,
  type Station,
} from './layout';
import type { PartColor, Pose, SceneConfig, Vec3 } from './types';

export { PART_SIZE };
export const HOME = HOME_JOINTS;

const half = PART_SIZE / 2;

export const DEFAULT_POSES: Pose[] = [
  ...posesForLayout(DEFAULT_LAYOUT),
  { name: 'STACK', x: 250, y: half, z: 330 },
];

export const DEFAULT_SCENE: SceneConfig = {
  colors: ['red', 'green', 'blue'],
  defectRate: 0.15,
  spacing: 110,
  maxParts: 0,
};

function round(v: Vec3): Vec3 {
  return { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) };
}

export interface Part {
  id: number;
  color: PartColor;
  defect: boolean;
  machined: boolean;
  pos: Vec3; // centre
  belt: string | null; // id of the conveyor carrying the part
}

export class AbortError extends Error {
  constructor() {
    super('Program stopped');
    this.name = 'AbortError';
  }
}

export class FaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultError';
  }
}

interface Motion {
  duration: number;
  elapsed: number;
  at: (s: number) => number[]; // s in [0, 1]
  resolve: () => void;
  reject: (e: Error) => void;
}

interface Waiter {
  until: () => boolean;
  deadline: number; // sim time; Infinity = none
  resolve: () => void;
  reject: (e: Error) => void;
  timeoutMessage: string;
}

// Hardware link (e.g. Web Serial). The sim always runs; the link mirrors
// commands to a real controller and the sim waits for its acknowledgement.
export interface HardwareLink {
  send(line: string): Promise<void>;
}

const JOINT_SPEED = 150; // deg/s at 100 %
const LINEAR_SPEED = 600; // mm/s at 100 %
const ease = (s: number) => s * s * (3 - 2 * s);

export class World {
  time = 0;
  speed = 1; // simulation speed multiplier
  paused = false;

  joints = [...HOME];
  gripperClosed = false;
  gripperWidth = 1; // 0 = closed, 1 = open (for rendering)
  held: Part | null = null;
  trail: Vec3[] = [];
  trailEnabled = false;

  parts: Part[] = [];
  private nextPartId = 1;
  spawned = 0;
  scene: SceneConfig = { ...DEFAULT_SCENE };
  layout: CellLayout = cloneLayout(DEFAULT_LAYOUT);
  // Solid the tool was already inside on the previous step (no repeat faults).
  private insideSolid: string | null = null;

  conveyorRunning = false;
  conveyorSpeed = 150;
  outputs = [false, false, false, false];
  operatorButton = false;

  machineBusyUntil = -1;
  machineDone = false;

  lastVision: { color: string; defect: boolean } | null = null;
  visionFlash = 0;

  stats = { picks: 0, places: 0, cycleStart: 0 };

  link: HardwareLink | null = null;

  private motion: Motion | null = null;
  private waiters: Waiter[] = [];
  private listeners = new Set<() => void>();
  private faultHandler: ((message: string) => void) | null = null;
  version = 0;

  // ── Subscriptions ────────────────────────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
  onFault(fn: ((message: string) => void) | null) {
    this.faultHandler = fn;
  }

  // ── Derived state ────────────────────────────────────────────────────────
  get tcp(): Vec3 {
    return forwardKinematics(this.joints);
  }
  get moving() {
    return this.motion !== null;
  }
  get conveyors(): Station[] {
    return this.layout.stations.filter((s) => s.kind === 'conveyor');
  }
  get machine(): Station | undefined {
    return this.layout.stations.find((s) => s.kind === 'machine');
  }
  station(id: string | null): Station | undefined {
    return id ? this.layout.stations.find((s) => s.id === id) : undefined;
  }
  // Parts waiting at a conveyor end stop, nearest to the tool first.
  partsAtPickPoints(): Part[] {
    const tcp = this.tcp;
    return this.parts
      .filter((p) => {
        const c = this.station(p.belt);
        return c && toLocal(c, p.pos.x, p.pos.z).x >= conveyorEnds(c).stop - 4;
      })
      .sort((a, b) => Math.hypot(a.pos.x - tcp.x, a.pos.z - tcp.z) - Math.hypot(b.pos.x - tcp.x, b.pos.z - tcp.z));
  }
  partAtPickPoint(): Part | undefined {
    return this.partsAtPickPoints()[0];
  }
  conveyorHasPart(c: Station): boolean {
    return this.partsAtPickPoints().some((p) => p.belt === c.id);
  }
  inMachineZone(p: Vec3): boolean {
    const m = this.machine;
    if (!m) return false;
    const l = toLocal(m, p.x, p.z);
    return l.x < MACHINE_ZONE_FRONT && Math.abs(l.z) < MACHINE_ZONE_HALF_WIDTH;
  }
  get inputs(): boolean[] {
    return [this.partsAtPickPoints().length > 0, this.machineDone, !this.inMachineZone(this.tcp), this.operatorButton];
  }
  get machineRunning() {
    return this.time < this.machineBusyUntil;
  }
  partOnFixture(): Part | undefined {
    const m = this.machine;
    if (!m) return undefined;
    return this.parts.find((p) => p !== this.held && Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < 40);
  }
  // Parts resting inside each bin, by station id.
  binCounts(): Record<string, number> {
    const bins = this.layout.stations.filter((s) => s.kind === 'bin');
    const counts: Record<string, number> = Object.fromEntries(bins.map((b) => [b.id, 0]));
    for (const p of this.parts) {
      if (p === this.held) continue;
      const bin = bins.find((b) => {
        const l = toLocal(b, p.pos.x, p.pos.z);
        return inBox(footprint(b), l.x, l.z);
      });
      if (bin) counts[bin.id]++;
    }
    return counts;
  }
  palletCount(): number {
    const pallets = this.layout.stations.filter((s) => s.kind === 'pallet');
    return this.parts.filter(
      (p) =>
        p !== this.held &&
        pallets.some((s) => {
          const l = toLocal(s, p.pos.x, p.pos.z);
          return inBox(footprint(s), l.x, l.z);
        }),
    ).length;
  }

  // Replaces the stations. Parts are cleared and trays refilled; the arm stays.
  setLayout(layout: CellLayout) {
    this.layout = cloneLayout(layout);
    this.reset(undefined, true);
  }

  // ── Reset ────────────────────────────────────────────────────────────────
  // `keepRobot` leaves the arm where it is (a real arm cannot teleport home),
  // but drops anything it holds.
  reset(scene?: SceneConfig, keepRobot = false) {
    this.abortAll();
    if (scene) this.scene = { ...scene };
    this.time = 0;
    if (!keepRobot) this.joints = [...HOME];
    this.gripperClosed = false;
    this.gripperWidth = 1;
    this.held = null;
    this.trail = [];
    this.parts = [];
    this.spawned = 0;
    this.nextPartId = 1;
    this.conveyorRunning = false;
    this.outputs = [false, false, false, false];
    this.machineBusyUntil = -1;
    this.machineDone = false;
    this.lastVision = null;
    this.stats = { picks: 0, places: 0, cycleStart: 0 };
    this.insideSolid = null;
    this.loadTrays();
    this.emit();
  }

  private loadTrays() {
    const colors = this.scene.colors.length ? this.scene.colors : (['red'] as PartColor[]);
    let i = 0;
    for (const s of this.layout.stations) {
      if (s.kind !== 'tray') continue;
      for (const pos of traySlots(s)) {
        this.parts.push({
          id: this.nextPartId++,
          color: colors[i++ % colors.length],
          defect: Math.random() < this.scene.defectRate,
          machined: false,
          pos,
          belt: null,
        });
      }
    }
  }

  abortAll() {
    const err = new AbortError();
    this.motion?.reject(err);
    this.motion = null;
    this.waiters.forEach((w) => w.reject(err));
    this.waiters = [];
  }

  private fault(message: string) {
    const err = new FaultError(message);
    this.motion?.reject(err);
    this.motion = null;
    this.waiters.forEach((w) => w.reject(err));
    this.waiters = [];
    this.outputs[3] = true;
    this.faultHandler?.(message);
    this.emit();
  }

  // ── Simulation step ──────────────────────────────────────────────────────
  tick(realDt: number) {
    if (this.paused) return;
    // Fixed small sub-steps keep fast-forwarded runs identical to real time.
    // Up to 1 s of catch-up covers background-tab timer throttling.
    let remaining = Math.min(realDt, 1) * this.speed;
    while (remaining > 1e-6) {
      const dt = Math.min(0.02, remaining);
      remaining -= dt;
      this.step(dt);
    }
    this.emit();
  }

  private step(dt: number) {
    this.time += dt;

    // Motion
    if (this.motion) {
      const m = this.motion;
      m.elapsed += dt;
      const s = m.duration <= 0 ? 1 : Math.min(1, m.elapsed / m.duration);
      try {
        this.joints = m.at(ease(s));
      } catch (e) {
        this.fault((e as Error).message);
      }
      if (this.motion === m && s >= 1) {
        this.motion = null;
        m.resolve();
      }
    }

    // Gripper animation
    const targetWidth = this.gripperClosed ? (this.held ? 0.45 : 0) : 1;
    this.gripperWidth += Math.sign(targetWidth - this.gripperWidth) * Math.min(Math.abs(targetWidth - this.gripperWidth), dt * 4);

    const tcp = this.tcp;
    if (this.held) this.held.pos = { x: tcp.x, y: tcp.y, z: tcp.z };
    if (this.trailEnabled) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - tcp.x, last.y - tcp.y, last.z - tcp.z) > 4) {
        this.trail.push(tcp);
        if (this.trail.length > 4000) this.trail.shift();
      }
    }

    // Conveyors: parts move towards the end stop and queue behind each other.
    if (this.conveyorRunning) {
      for (const c of this.conveyors) this.stepConveyor(c, dt);
    }

    // Machine
    if (this.machineBusyUntil > 0 && this.time >= this.machineBusyUntil) {
      this.machineBusyUntil = -1;
      const p = this.partOnFixture();
      if (p) p.machined = true;
      this.machineDone = true;
    }
    if (this.machineRunning && this.inMachineZone(tcp)) {
      this.fault('Safety interlock: the robot entered the machine zone during a cycle (DI2 was off).');
    }
    if (this.motion || this.held) this.checkCollisions(tcp);

    if (this.visionFlash > 0) this.visionFlash = Math.max(0, this.visionFlash - dt * 3);

    // Waiters
    if (this.waiters.length) {
      const pending: Waiter[] = [];
      for (const w of this.waiters) {
        if (w.until()) w.resolve();
        else if (this.time >= w.deadline) w.reject(new FaultError(w.timeoutMessage));
        else pending.push(w);
      }
      this.waiters = pending;
    }
  }

  private stepConveyor(c: Station, dt: number) {
    const ends = conveyorEnds(c);
    const belt = this.parts
      .filter((p) => p.belt === c.id && p !== this.held)
      .map((p) => ({ p, l: toLocal(c, p.pos.x, p.pos.z) }))
      .sort((a, b) => b.l.x - a.l.x);
    let limit = ends.stop;
    for (const { p, l } of belt) {
      const x = Math.min(limit, l.x + this.conveyorSpeed * dt);
      const w = toWorld(c, Math.max(x, l.x), l.z);
      p.pos.x = w.x;
      p.pos.z = w.z;
      limit = Math.max(x, l.x) - PART_SIZE - 6;
    }
    const lastX = belt.length ? Math.min(...belt.map((b) => b.l.x)) : Infinity;
    const canSpawn = this.scene.maxParts === 0 || this.spawned < this.scene.maxParts;
    if (canSpawn && lastX - ends.start > this.scene.spacing) this.spawnPart(c);
  }

  private spawnPart(c: Station) {
    const colors = this.scene.colors.length ? this.scene.colors : (['red'] as PartColor[]);
    const at = toWorld(c, conveyorEnds(c).start + half, 0);
    this.parts.push({
      id: this.nextPartId++,
      color: colors[Math.floor(Math.random() * colors.length)],
      defect: Math.random() < this.scene.defectRate,
      machined: false,
      pos: { x: at.x, y: CONVEYOR_TOP + half, z: at.z },
      belt: c.id,
    });
    this.spawned++;
  }

  // Faults when the tool (or the bottom of a held part) enters a solid station.
  private checkCollisions(tcp: Vec3) {
    const bottom = this.held ? tcp.y - half : tcp.y;
    let hit: Station | null = null;
    if (bottom < -2) hit = { id: 'floor', kind: 'table', name: 'the floor', x: 0, z: 0, rot: 0 };
    for (const s of this.layout.stations) {
      if (hit) break;
      const l = toLocal(s, tcp.x, tcp.z);
      for (const b of stationBoxes(s)) {
        if (inBox(b, l.x, l.z) && bottom < b.top - 3) {
          hit = s;
          break;
        }
      }
    }
    const id = hit?.id ?? null;
    if (hit && id !== this.insideSolid) {
      this.insideSolid = id;
      this.fault(`Collision: the ${this.held ? 'held part' : 'tool'} hit ${hit.name}.`);
      return;
    }
    this.insideSolid = id;
  }

  // ── Commands ─────────────────────────────────────────────────────────────
  // `segments` is how many J commands the hardware link receives: 1 for a
  // joint move, several waypoints for a linear move.
  private startMotion(duration: number, at: (s: number) => number[], segments = 1): Promise<void> {
    if (this.motion) this.motion.reject(new AbortError());
    const sim = new Promise<void>((resolve, reject) => {
      this.motion = { duration, elapsed: 0, at, resolve, reject };
    });
    const link = this.link;
    if (!link) return sim;
    const hw = (async () => {
      for (let i = 1; i <= segments; i++) {
        const q = at(i / segments);
        await link.send(`J ${q.map((a) => a.toFixed(1)).join(' ')} ${(duration / segments).toFixed(2)}`);
      }
    })();
    return Promise.all([sim, hw]).then(() => undefined);
  }

  moveJoints(target: number[], speedPct: number): Promise<void> {
    const bad = checkLimits(target);
    if (bad !== null) {
      return Promise.reject(
        new FaultError(`J${bad + 1} target ${target[bad].toFixed(1)}° is outside ${JOINT_LIMITS[bad][0]}…${JOINT_LIMITS[bad][1]}°`),
      );
    }
    const from = [...this.joints];
    const maxDelta = Math.max(...target.map((t, i) => Math.abs(t - from[i])));
    const duration = maxDelta / (JOINT_SPEED * clampSpeed(speedPct));
    return this.startMotion(
      duration,
(s) => from.map((q, i) => q + (target[i] - q) * s));
  }

  moveTo(target: Vec3, mode: 'joint' | 'linear', speedPct: number): Promise<void> {
    let goal: number[];
    try {
      goal = inverseKinematics(target, this.joints[5]);
    } catch (e) {
      return Promise.reject(new FaultError((e as Error).message));
    }
    if (mode === 'joint') return this.moveJoints(goal, speedPct);

    const from = this.tcp;
    const dist = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
    const lerp = (s: number): Vec3 => ({
      x: from.x + (target.x - from.x) * s,
      y: from.y + (target.y - from.y) * s,
      z: from.z + (target.z - from.z) * s,
    });
    // Validate the whole straight-line path up front.
    for (let i = 1; i <= 24; i++) {
      try {
        inverseKinematics(lerp(i / 24));
      } catch (e) {
        const reason = e instanceof UnreachableError ? e.message : String(e);
        return Promise.reject(new FaultError(`Linear path is not feasible — ${reason}`));
      }
    }
    const roll = this.joints[5];
    const duration = dist / (LINEAR_SPEED * clampSpeed(speedPct));
    return this.startMotion(
      duration,
      (s) => inverseKinematics(lerp(s), roll),
      Math.max(1, Math.ceil(dist / 20)),
    );
  }

  async setGripper(close: boolean): Promise<boolean> {
    this.gripperClosed = close;
    if (close) {
      const tcp = this.tcp;
      const part = this.parts
        .filter((p) => p !== this.held)
        .find((p) => Math.hypot(p.pos.x - tcp.x, p.pos.y - tcp.y, p.pos.z - tcp.z) < 30);
      if (part && !this.held) {
        const fromFixture = part === this.partOnFixture();
        if (fromFixture && this.machineRunning) {
          this.fault('Cannot grip a part while the machine is cycling.');
        }
        this.held = part;
        part.belt = null;
        if (fromFixture) this.machineDone = false;
        this.stats.picks++;
      }
    } else if (this.held) {
      const p = this.held;
      this.held = null;
      p.pos.y = this.supportHeight(p) + half;
      if (p.pos.y > 0) this.stats.places++;
    }
    await Promise.all([this.sleep(0.35), this.link?.send(`G ${close ? 1 : 0}`)]);
    return !!this.held;
  }

  // Height of whatever is under a released part.
  private supportHeight(p: Part): number {
    let top = 0;
    for (const s of this.layout.stations) {
      const l = toLocal(s, p.pos.x, p.pos.z);
      for (const b of stationBoxes(s)) {
        if (inBox(b, l.x, l.z) && b.top <= p.pos.y + 1 && b.top > top) {
          top = b.top;
          p.belt = s.kind === 'conveyor' ? s.id : null;
        }
      }
    }
    for (const o of this.parts) {
      if (o === p) continue;
      if (Math.abs(o.pos.x - p.pos.x) < PART_SIZE * 0.8 && Math.abs(o.pos.z - p.pos.z) < PART_SIZE * 0.8 && o.pos.y < p.pos.y) {
        if (o.pos.y + half > top) {
          top = o.pos.y + half;
          p.belt = null;
        }
      }
    }
    return top;
  }

  setConveyor(run: boolean, speed?: number) {
    this.conveyorRunning = run;
    if (speed !== undefined) this.conveyorSpeed = Math.max(10, Math.min(500, speed));
    return this.setOutput(0, run);
  }

  async setOutput(channel: number, on: boolean) {
    const rising = on && !this.outputs[channel];
    this.outputs[channel] = on;
    if (channel === 0) this.conveyorRunning = on;
    if (channel === 1 && rising) {
      if (!this.inputs[2]) {
        this.fault('Machine refused to start: the robot is inside the machine zone (DI2 off).');
      } else {
        this.machineDone = false;
        const m = this.machine;
        this.machineBusyUntil = this.time + (m ? param(m, 'cycle') : 4);
      }
    }
    this.emit();
    await this.link?.send(`O ${channel} ${on ? 1 : 0}`);
  }

  inspect(): { color: string; defect: boolean } {
    // Conveyor camera first; otherwise the wrist camera sees the held part.
    const part = this.partAtPickPoint() ?? this.held ?? undefined;
    this.visionFlash = 1;
    this.lastVision = part ? { color: part.color, defect: part.defect } : { color: 'none', defect: false };
    return this.lastVision;
  }

  sleep(seconds: number): Promise<void> {
    const end = this.time + Math.max(0, seconds);
    return this.waitFor(() => this.time >= end, 0, '');
  }

  waitFor(until: () => boolean, timeoutSeconds: number, timeoutMessage: string): Promise<void> {
    if (until()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.waiters.push({
        until,
        deadline: timeoutSeconds > 0 ? this.time + timeoutSeconds : Infinity,
        resolve,
        reject,
        timeoutMessage,
      });
    });
  }
}

function clampSpeed(pct: number) {
  return Math.max(1, Math.min(100, pct || 50)) / 100;
}
