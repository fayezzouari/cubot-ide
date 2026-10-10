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
  forwardKinematics,
  HOME_JOINTS,
  inverseKinematics,
  JOINT_LIMITS,
  toolYaw,
  UnreachableError,
} from './kinematics';
import {
  BIN_WALL_THICKNESS,
  cloneLayout,
  CONVEYOR_TOP,
  CONVEYOR_WIDTH,
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

const GRAVITY = 9810; // mm/s²
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
    const targetWidth = this.gripperClosed ? (this.held ? 0.45 : 0) : 1;
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
    const pointHits = (p: Vec3, r: number, floorY: number) => {
      for (const s of this.layout.stations) {
        const l = toLocal(s, p.x, p.z);
        for (const b of stationBoxes(s)) {
          if (inBox(b, l.x, l.z, r) && floorY < b.top - 3) return s;
        }
      }
      return null;
    };
    // Tool tip, or the held part's footprint.
    const s = pointHits(tcp, held ? half - 4 : 0, bottom);
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
    // Arm links.
    for (const { p, r } of armSamples(this.joints)) {
      if (p.y - r < 0) return { key: 'floor', what: 'the arm', name: 'the floor' };
      for (const st of this.layout.stations) {
        const l = toLocal(st, p.x, p.z);
        for (const b of stationBoxes(st)) {
          if (inBox(b, l.x, l.z, r) && p.y - r < b.top) return { key: `arm-${st.id}`, what: 'the arm', name: st.name };
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
        if (b.top <= top + 1 || !inBox(b, l.x, l.z, half)) continue;
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
