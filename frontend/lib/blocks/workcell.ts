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
  armSamples,
  checkLimits,
  FINGER,
  forwardKinematics,
  HOME_JOINTS,
  inverseKinematics,
  JOINT_LIMITS,
  rollFor,
  toolYaw,
  wrap180,
  UnreachableError,
} from './kinematics';
import {
  BIN_WALL_THICKNESS,
  cloneLayout,
  CONVEYOR_TOP,
  CONVEYOR_WIDTH,
  conveyorCamera,
  conveyorEnds,
  DEFAULT_LAYOUT,
  footprint,
  inBox,
  MACHINE_ZONE_FRONT,
  MACHINE_ZONE_HALF_WIDTH,
  PART_SIZE,
  param,
  posesForLayout,
  rectsOverlap,
  stationBoxes,
  toLocal,
  toWorld,
  traySlots,
  type CellLayout,
  type Station,
} from './layout';
import type { PartColor, Pose, SceneConfig, Vec3 } from './types';
import { analyze, DEFAULT_VISION, type Frame, type VisionConfig, type VisionResult } from './vision';

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
  yaw: number; // degrees about +Y
  fall: Fall | null; // set while the part drops after release
}

// A falling part follows a ballistic drop to its resting place. The landing
// spot is solved when the fall starts, so the part can slide a little sideways
// on the way down (tipping off an edge, settling into a pile).
interface Fall {
  from: Vec3;
  to: Vec3;
  t: number;
  duration: number;
  belt: string | null;
}

// Where a part would come to rest, and whether it would stay there.
interface Rest {
  y: number; // centre height
  belt: string | null;
  stable: boolean;
  push: { x: number; z: number } | null; // shift that would resolve an unstable rest
}

// A move target: a TCP position plus an optional tool angle (see Pose.rz).
export type Target = Vec3 & { rz?: number | null };

// A camera the 3D view can render from (mm, world frame).
export interface CameraSpec {
  id: string; // conveyor station id, or "wrist"
  name: string;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number; // vertical, degrees
  width: number;
  height: number;
}

export const CAMERA_RESOLUTION = { width: 160, height: 120 };
// Wrist camera: beside the gripper, looking down between the fingers.
export const WRIST_CAMERA = { above: 100, side: 45, fov: 55 };

export interface Inspection {
  time: number;
  camera: string; // camera id
  cameraName: string;
  source: 'camera' | 'ground truth';
  color: string;
  defect: boolean;
  area: number;
  cx: number;
  cy: number;
  frame: Frame | null;
  analysis: VisionResult | null;
}

const GRAVITY = 9810; // mm/s²
// Gripper opening, 0 = closed on nothing, 1 = fully open.
const HOLD_WIDTH = (FINGER.holding - FINGER.closed) / (FINGER.open - FINGER.closed);
export const fingerOffset = (width: number) => FINGER.closed + (FINGER.open - FINGER.closed) * width;
const QUEUE_GAP = 1; // accumulating conveyor: parts touch

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
  // Set when support under resting parts may have changed (a pick, a landing).
  private supportsDirty = false;
  // Simulated time left over from a tick that stopped early (see tick).
  private debt = 0;
  private yieldNow = false;

  conveyorRunning = false;
  conveyorSpeed = 150;
  outputs = [false, false, false, false];
  operatorButton = false;

  machineBusyUntil = -1;
  machineDone = false;

  lastVision: Inspection | null = null;
  vision: VisionConfig = structuredClone(DEFAULT_VISION);
  // Set by the 3D view: renders what a camera sees. Null without a view
  // (tests, background runs); inspection then falls back to ground truth.
  captureCamera: ((spec: CameraSpec) => Frame | null) | null = null;
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
    this.supportsDirty = false;
    this.debt = 0;
    this.yieldNow = false;
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
          yaw: s.rot,
          fall: null,
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
    let remaining = Math.min(realDt, 1) * this.speed + this.debt;
    this.debt = 0;
    while (remaining > 1e-6) {
      const dt = Math.min(0.02, remaining);
      remaining -= dt;
      this.step(dt);
      // A command finished: stop the clock here so the program's next command
      // starts at this exact moment, not at the end of the tick. Without this,
      // cycle times would depend on the frame rate and simulation speed.
      if (this.yieldNow) {
        this.yieldNow = false;
        this.debt = Math.min(remaining, 5 * this.speed);
        break;
      }
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
        this.yieldNow = true;
      }
    }

    // Gripper animation
    const targetWidth = this.gripperClosed ? (this.held ? HOLD_WIDTH : 0) : 1;
    this.gripperWidth += Math.sign(targetWidth - this.gripperWidth) * Math.min(Math.abs(targetWidth - this.gripperWidth), dt * 4);

    const tcp = this.tcp;
    if (this.held) {
      this.held.pos = { x: tcp.x, y: tcp.y, z: tcp.z };
      this.held.yaw = toolYaw(this.joints);
    }
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

    this.stepFalling(dt);
    if (this.supportsDirty) {
      this.supportsDirty = false;
      this.settleUnsupported();
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
        if (w.until()) {
          w.resolve();
          this.yieldNow = true;
        }
        else if (this.time >= w.deadline) w.reject(new FaultError(w.timeoutMessage));
        else pending.push(w);
      }
      this.waiters = pending;
    }
  }

  private stepConveyor(c: Station, dt: number) {
    const ends = conveyorEnds(c);
    const belt = this.parts
      .filter((p) => p.belt === c.id && p !== this.held && !p.fall)
      .map((p) => ({ p, l: toLocal(c, p.pos.x, p.pos.z) }))
      .sort((a, b) => b.l.x - a.l.x);
    let limit = ends.stop;
    // A part being lifted out of the lane still blocks the queue until its
    // bottom clears the parts behind it.
    const held = this.held;
    let heldX = Infinity;
    if (held && held.pos.y - half < CONVEYOR_TOP + PART_SIZE - 1) {
      const hl = toLocal(c, held.pos.x, held.pos.z);
      if (Math.abs(hl.z) < CONVEYOR_WIDTH / 2 + half && hl.x > ends.start && hl.x < ends.end) heldX = hl.x;
    }
    for (const { p, l } of belt) {
      if (l.x < heldX) limit = Math.min(limit, heldX - PART_SIZE - QUEUE_GAP);
      const x = Math.min(limit, l.x + this.conveyorSpeed * dt);
      const w = toWorld(c, Math.max(x, l.x), l.z);
      p.pos.x = w.x;
      p.pos.z = w.z;
      limit = Math.max(x, l.x) - PART_SIZE - QUEUE_GAP;
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
      yaw: c.rot,
      fall: null,
    });
    this.spawned++;
  }

  // Faults when the tool, a held part or an arm link enters a solid station or
  // another part. Only entering counts, so the arm can always move back out.
  private checkCollisions(tcp: Vec3) {
    const hit = this.findCollision(tcp);
    const key = hit?.key ?? null;
    if (hit && key !== this.insideSolid) {
      this.insideSolid = key;
      this.fault(`Collision: ${hit.what} hit ${hit.name}.`);
      return;
    }
    this.insideSolid = key;
  }

  private findCollision(tcp: Vec3): { key: string; what: string; name: string } | null {
    const held = this.held;
    const bottom = held ? tcp.y - half : tcp.y;
    const what = held ? 'the held part' : 'the gripper';
    if (bottom < -2) return { key: 'floor', what, name: 'the floor' };
    const pointHits = (p: Vec3, r: number, floorY: number, ceilY: number) => {
      for (const s of this.layout.stations) {
        const l = toLocal(s, p.x, p.z);
        for (const b of stationBoxes(s)) {
          if (inBox(b, l.x, l.z, r) && floorY < b.top - 3 && ceilY > (b.bottom ?? 0)) return { id: s.id, name: hitName(s, b) };
        }
      }
      return null;
    };
    // Tool tip, or the held part's footprint.
    const s = pointHits(tcp, held ? half - 4 : 0, bottom, tcp.y + FINGER.length);
    if (s) return { key: s.id, what, name: s.name };
    // Held part against parts resting in the cell.
    if (held) {
      for (const o of this.parts) {
        if (o === held || o.fall) continue;
        if (Math.abs(o.pos.x - tcp.x) < PART_SIZE - 4 && Math.abs(o.pos.z - tcp.z) < PART_SIZE - 4 && Math.abs(o.pos.y - tcp.y) < PART_SIZE - 4) {
          return { key: `part-${o.id}`, what, name: 'another part' };
        }
      }
    }
    // Gripper fingers: two thin plates either side of the tool axis, from the
    // fingertips (at the TCP) up their length.
    const yaw = toolYaw(this.joints);
    const ax = Math.cos((yaw * Math.PI) / 180);
    const az = -Math.sin((yaw * Math.PI) / 180);
    const off = fingerOffset(this.gripperWidth);
    const fingerLow = tcp.y - 2.5;
    const fingerHigh = tcp.y + FINGER.length - 2.5;
    for (const side of [-1, 1]) {
      const finger = { x: tcp.x + ax * off * side, z: tcp.z + az * off * side, yaw, w: FINGER.thickness, d: FINGER.depth };
      for (const o of this.parts) {
        if (o === held || o.fall) continue;
        if (o.pos.y + half < fingerLow + 1 || o.pos.y - half > fingerHigh) continue;
        if (rectsOverlap(finger, { x: o.pos.x, z: o.pos.z, yaw: o.yaw, w: PART_SIZE, d: PART_SIZE }, -1)) {
          return { key: `finger-${o.id}`, what: 'a gripper finger', name: 'another part' };
        }
      }
      for (const st of this.layout.stations) {
        for (const b of stationBoxes(st)) {
          if (fingerLow >= b.top - 3 || fingerHigh <= (b.bottom ?? 0)) continue;
          const c = toWorld(st, b.cx, b.cz);
          if (rectsOverlap(finger, { x: c.x, z: c.z, yaw: st.rot, w: b.w, d: b.d })) {
            return { key: `finger-${st.id}`, what: 'a gripper finger', name: hitName(st, b) };
          }
        }
      }
    }
    // Arm links.
    for (const { p, r } of armSamples(this.joints)) {
      if (p.y - r < 0) return { key: 'floor', what: 'the arm', name: 'the floor' };
      for (const st of this.layout.stations) {
        const l = toLocal(st, p.x, p.z);
        for (const b of stationBoxes(st)) {
          if (inBox(b, l.x, l.z, r) && p.y - r < b.top && p.y + r > (b.bottom ?? 0)) {
            return { key: `arm-${st.id}`, what: 'the arm', name: hitName(st, b) };
          }
        }
      }
    }
    return null;
  }

  // ── Part physics ─────────────────────────────────────────────────────────

  private startFall(p: Part) {
    const rest = this.findRest(p, p.pos.x, p.pos.z);
    const drop = p.pos.y - rest.y;
    if (drop <= 0.5 && Math.hypot(rest.x - p.pos.x, rest.z - p.pos.z) < 0.5) {
      p.pos.y = rest.y;
      p.belt = rest.belt;
      return;
    }
    // Free fall from rest; a small floor on the time keeps sideways slides visible.
    const duration = Math.max(0.08, Math.sqrt((2 * Math.max(drop, 0)) / GRAVITY));
    p.fall = { from: { ...p.pos }, to: { x: rest.x, y: rest.y, z: rest.z }, t: 0, duration, belt: rest.belt };
    p.belt = null;
  }

  private stepFalling(dt: number) {
    for (const p of this.parts) {
      const f = p.fall;
      if (!f) continue;
      f.t += dt;
      const s = Math.min(1, f.t / f.duration);
      const drop = f.from.y - f.to.y;
      p.pos.x = f.from.x + (f.to.x - f.from.x) * s;
      p.pos.z = f.from.z + (f.to.z - f.from.z) * s;
      p.pos.y = drop > 0 ? Math.max(f.to.y, f.from.y - 0.5 * GRAVITY * f.t * f.t) : f.from.y + (f.to.y - f.from.y) * s;
      if (s >= 1) {
        p.pos = { ...f.to };
        p.belt = f.belt;
        p.fall = null;
        this.supportsDirty = true;
      }
    }
  }

  // Parts whose support went away (picked from under them, a part landed
  // badly) drop to their new resting place, lowest first.
  private settleUnsupported() {
    const resting = this.parts.filter((p) => p !== this.held && !p.fall && !p.belt).sort((a, b) => a.pos.y - b.pos.y);
    for (const p of resting) {
      const r = this.restAt(p, p.pos.x, p.pos.z);
      if (!r.stable || r.y < p.pos.y - 0.5) this.startFall(p);
    }
  }

  // How a part with its centre at (x, z) would rest, given the stations and
  // the other parts. A part is stable when its centre of mass is over what
  // supports it; otherwise `push` says which way it tips or slides.
  private restAt(p: Part, x: number, z: number): Rest {
    let top = 0;
    let belt: string | null = null;
    for (const s of this.layout.stations) {
      const l = toLocal(s, x, z);
      for (const b of stationBoxes(s)) {
        if (b.bottom) continue; // overhangs (camera heads) don't hold parts
        if (inBox(b, l.x, l.z) && b.top > top && b.top <= p.pos.y - half + 1) {
          top = b.top;
          belt = s.kind === 'conveyor' ? s.id : null;
        }
      }
    }
    // A taller station box overlapping the footprint blocks this spot: push
    // the part out along the shallower side.
    for (const s of this.layout.stations) {
      const l = toLocal(s, x, z);
      for (const b of stationBoxes(s)) {
        if (b.top <= top + 1 || (b.bottom ?? 0) >= top + PART_SIZE || !inBox(b, l.x, l.z, half)) continue;
        const px = b.w / 2 + half - Math.abs(l.x - b.cx);
        const pz = b.d / 2 + half - Math.abs(l.z - b.cz);
        const local = px < pz ? { x: Math.sign(l.x - b.cx || 1) * (px + 1), z: 0 } : { x: 0, z: Math.sign(l.z - b.cz || 1) * (pz + 1) };
        const w0 = toWorld(s, 0, 0);
        const w1 = toWorld(s, local.x, local.z);
        return { y: top + half, belt, stable: false, push: { x: w1.x - w0.x, z: w1.z - w0.z } };
      }
    }
    // Other parts under the footprint. The part rests on the highest of them;
    // it is stable when its centre of mass lies over the area those parts
    // support (one part, or several bridged at the same height).
    let partTop = top;
    let level: Part[] = [];
    for (const o of this.parts) {
      if (o === p || o === this.held || o.fall) continue;
      if (Math.abs(o.pos.x - x) >= PART_SIZE - 0.5 || Math.abs(o.pos.z - z) >= PART_SIZE - 0.5) continue;
      if (o.pos.y > p.pos.y + 1) continue;
      const t = o.pos.y + half;
      if (t > partTop + 0.5) {
        partTop = t;
        level = [o];
      } else if (Math.abs(t - partTop) <= 0.5 && partTop > top) {
        level.push(o);
      }
    }
    if (!level.length) return { y: top + half, belt, stable: true, push: null };
    // Support area: the parts' tops, clipped to this part's footprint.
    const minX = Math.max(x - half, Math.min(...level.map((o) => o.pos.x - half)));
    const maxX = Math.min(x + half, Math.max(...level.map((o) => o.pos.x + half)));
    const minZ = Math.max(z - half, Math.min(...level.map((o) => o.pos.z - half)));
    const maxZ = Math.min(z + half, Math.max(...level.map((o) => o.pos.z + half)));
    const margin = 2;
    if (x > minX + margin && x < maxX - margin && z > minZ + margin && z < maxZ - margin) {
      return { y: partTop + half, belt: null, stable: true, push: null };
    }
    // Centre of mass past the edge: it tips off on that side of the nearest part.
    const near = level.reduce((a, b) => (Math.hypot(b.pos.x - x, b.pos.z - z) < Math.hypot(a.pos.x - x, a.pos.z - z) ? b : a));
    const dx = x - near.pos.x;
    const dz = z - near.pos.z;
    const push =
      Math.abs(dx) >= Math.abs(dz)
        ? { x: near.pos.x + Math.sign(dx || 1) * (PART_SIZE + 1) - x, z: 0 }
        : { x: 0, z: near.pos.z + Math.sign(dz || 1) * (PART_SIZE + 1) - z };
    return { y: partTop + half, belt: null, stable: false, push };
  }

  // Resting place for a part released at (x0, z0).
  private findRest(p: Part, x0: number, z0: number): Vec3 & { belt: string | null } {
    const bin = this.layout.stations.find((s) => {
      if (s.kind !== 'bin') return false;
      const l = toLocal(s, x0, z0);
      const inner = param(s, 'size') / 2 - BIN_WALL_THICKNESS;
      return Math.abs(l.x) < inner && Math.abs(l.z) < inner && p.pos.y - half > 0;
    });
    if (bin) {
      // Dropped into a bin: the part tumbles to the lowest stable spot nearby,
      // so bins fill as a pile instead of a tower.
      const inner = param(bin, 'size') / 2 - BIN_WALL_THICKNESS - half - 1;
      let best: (Vec3 & { belt: string | null }) | null = null;
      let bestScore = Infinity;
      const l0 = toLocal(bin, x0, z0);
      const consider = (lx: number, lz: number) => {
        lx = Math.max(-inner, Math.min(inner, lx));
        lz = Math.max(-inner, Math.min(inner, lz));
        const w = toWorld(bin, lx, lz);
        const rest = this.restAt(p, w.x, w.z);
        if (!rest.stable) return;
        // Lower wins (the part falls into gaps); among equals, nearest wins.
        const score = rest.y * 3 + Math.hypot(lx - l0.x, lz - l0.z) * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = { x: w.x, y: rest.y, z: w.z, belt: rest.belt };
        }
      };
      consider(l0.x, l0.z);
      for (let lx = -inner; lx <= inner + 0.01; lx += 10) {
        for (let lz = -inner; lz <= inner + 0.01; lz += 10) consider(lx, lz);
      }
      for (const c of [-inner, inner]) {
        consider(c, -inner);
        consider(c, inner);
      }
      if (best) return best;
    }
    // Elsewhere the part stays where it was released unless it would tip off
    // something or overlap a station; then it slides off that side.
    let x = x0;
    let z = z0;
    for (let i = 0; i < 6; i++) {
      const rest = this.restAt(p, x, z);
      if (rest.stable || !rest.push) return { x, y: rest.y, z, belt: rest.belt };
      x += rest.push.x;
      z += rest.push.z;
    }
    const rest = this.restAt(p, x, z);
    return { x, y: rest.y, z, belt: rest.belt };
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

  // Moves the TCP to `target`. With `rz` the tool turns to that angle;
  // without, it keeps its current angle in the cell (both move types). Linear moves hold the tool angle
  // fixed along the path (turning smoothly to the new one), like a real
  // robot's straight-line motion.
  moveTo(target: Target, mode: 'joint' | 'linear', speedPct: number): Promise<void> {
    const fromRoll = this.joints[5];
    const startYaw = toolYaw(this.joints);
    const endYaw = typeof target.rz === 'number' ? target.rz : startYaw;
    const rollAt = (p: Vec3, yawDeg: number, near: number) => {
      const r = rollFor(p, yawDeg, near);
      if (r === null) throw new UnreachableError(p, `tool angle ${yawDeg.toFixed(0)}° needs J6 outside ±180°`);
      return r;
    };

    if (mode === 'joint') {
      let goal: number[];
      try {
        // Without an angle the tool keeps its current orientation in the cell,
        // so a part stays square to the fingers however far the base turns.
        const roll = rollAt(target, endYaw, fromRoll);
        goal = inverseKinematics(target, roll);
      } catch (e) {
        return Promise.reject(new FaultError((e as Error).message));
      }
      return this.moveJoints(goal, speedPct);
    }

    const from = this.tcp;
    const dist = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
    const turn = wrap180(endYaw - startYaw);
    const lerp = (s: number): Vec3 => ({
      x: from.x + (target.x - from.x) * s,
      y: from.y + (target.y - from.y) * s,
      z: from.z + (target.z - from.z) * s,
    });
    // Solve the whole path up front: it must be reachable, and J6 must follow
    // continuously (no flips through ±180°).
    const steps = Math.max(24, Math.ceil(dist / 10), Math.ceil(Math.abs(turn) / 3));
    const path: number[][] = [];
    let roll = fromRoll;
    for (let i = 0; i <= steps; i++) {
      const p = lerp(i / steps);
      try {
        roll = rollAt(p, startYaw + turn * (i / steps), roll);
        path.push(inverseKinematics(p, roll));
      } catch (e) {
        const reason = e instanceof UnreachableError ? e.message : String(e);
        return Promise.reject(new FaultError(`Linear path is not feasible — ${reason}`));
      }
      if (i > 0 && Math.abs(path[i][5] - path[i - 1][5]) > 30) {
        return Promise.reject(new FaultError('Linear path is not feasible — J6 would flip; teach the pose with a different tool angle'));
      }
    }
    const duration = Math.max(dist / (LINEAR_SPEED * clampSpeed(speedPct)), Math.abs(turn) / (JOINT_SPEED * clampSpeed(speedPct)));
    const at = (s: number) => {
      const f = s * steps;
      const i = Math.min(steps - 1, Math.floor(f));
      const t = f - i;
      return path[i].map((q, k) => q + (path[i + 1][k] - q) * t);
    };
    return this.startMotion(duration, at, Math.max(1, Math.ceil(dist / 20), Math.ceil(Math.abs(turn) / 10)));
  }

  async setGripper(close: boolean): Promise<boolean> {
    this.gripperClosed = close;
    if (close) {
      const tcp = this.tcp;
      // The part must sit between the fingers: centred under the tool and
      // within the finger length vertically.
      const part = this.parts
        .filter((p) => p !== this.held && !p.fall)
        .find((p) => Math.hypot(p.pos.x - tcp.x, p.pos.z - tcp.z) < 18 && Math.abs(p.pos.y - tcp.y) < 22);
      if (part && !this.held) {
        const fromFixture = part === this.partOnFixture();
        if (fromFixture && this.machineRunning) {
          this.fault('Cannot grip a part while the machine is cycling.');
        }
        this.held = part;
        part.belt = null;
        if (fromFixture) this.machineDone = false;
        this.stats.picks++;
        // Whatever was resting on the part loses its support.
        this.supportsDirty = true;
      }
    } else if (this.held) {
      const p = this.held;
      this.held = null;
      this.insideSolid = null;
      this.startFall(p);
      this.stats.places++;
    }
    await Promise.all([this.sleep(0.35), this.link?.send(`G ${close ? 1 : 0}`)]);
    return !!this.held;
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

  // Every camera in the cell: one per conveyor, plus the wrist camera.
  cameraSpecs(): CameraSpec[] {
    const specs: CameraSpec[] = this.conveyors.map((c) => {
      const cam = conveyorCamera(c);
      // The image is taken at the lens, a little in front of the head centre.
      const dx = cam.target.x - cam.head.x;
      const dy = cam.target.y - cam.head.y;
      const dz = cam.target.z - cam.head.z;
      const n = Math.hypot(dx, dy, dz);
      const lens = toWorld(c, cam.head.x + (dx / n) * 50, cam.head.z + (dz / n) * 50);
      const target = toWorld(c, cam.target.x, cam.target.z);
      return {
        id: c.id,
        name: `${c.name} camera`,
        position: { x: lens.x, y: cam.head.y + (dy / n) * 50, z: lens.z },
        target: { x: target.x, y: cam.target.y, z: target.z },
        up: { x: 0, y: 1, z: 0 },
        fov: 15,
        ...CAMERA_RESOLUTION,
      };
    });
    const tcp = this.tcp;
    const yaw = (toolYaw(this.joints) * Math.PI) / 180;
    // Finger axis is (cos, -sin); the camera sits off the gripper's side.
    const side = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    specs.push({
      id: 'wrist',
      name: 'Wrist camera',
      position: {
        x: tcp.x + side.x * WRIST_CAMERA.side,
        y: tcp.y + WRIST_CAMERA.above,
        z: tcp.z + side.z * WRIST_CAMERA.side,
      },
      target: { x: tcp.x, y: tcp.y - 15, z: tcp.z },
      up: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) },
      fov: WRIST_CAMERA.fov,
      ...CAMERA_RESOLUTION,
    });
    return specs;
  }

  // Picks the camera for an inspection. "auto": the conveyor camera of the
  // waiting part nearest the tool, else the wrist camera when holding a part,
  // else the first conveyor camera. Otherwise a camera id or name.
  private pickCamera(choice: string): CameraSpec | undefined {
    const specs = this.cameraSpecs();
    const want = choice.trim().toLowerCase();
    if (want && want !== 'auto') {
      return specs.find(
        (c) => c.id.toLowerCase() === want || c.name.toLowerCase() === want || c.name.toLowerCase() === `${want} camera`,
      );
    }
    const waiting = this.partAtPickPoint();
    if (waiting?.belt) return specs.find((c) => c.id === waiting.belt);
    if (this.held) return specs.find((c) => c.id === 'wrist');
    return specs[0];
  }

  // Takes an image with a camera and analyses it (see vision.ts). Without a
  // renderer the answer comes from the simulation state instead.
  inspect(choice = 'auto'): Inspection {
    this.visionFlash = 1;
    const spec = this.pickCamera(choice);
    if (!spec) throw new FaultError(`No camera called "${choice}"`);
    const frame = this.captureCamera?.(spec) ?? null;
    let result: Inspection;
    if (frame) {
      const a = analyze(frame, this.vision);
      result = { time: this.time, camera: spec.id, cameraName: spec.name, source: 'camera', color: a.color, defect: a.defect, area: a.area, cx: a.cx, cy: a.cy, frame, analysis: a };
    } else {
      const part = spec.id === 'wrist' ? this.held : this.partsAtPickPoints().find((p) => p.belt === spec.id);
      result = {
        time: this.time,
        camera: spec.id,
        cameraName: spec.name,
        source: 'ground truth',
        color: part ? part.color : 'none',
        defect: part ? part.defect : false,
        area: part ? 30 : 0,
        cx: 0,
        cy: 0,
        frame: null,
        analysis: null,
      };
    }
    this.lastVision = result;
    this.emit();
    return result;
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

function hitName(s: Station, b: { label?: string }) {
  return b.label ? `${s.name} ${b.label}` : s.name;
}

function clampSpeed(pct: number) {
  return Math.max(1, Math.min(100, pct || 50)) / 100;
}
