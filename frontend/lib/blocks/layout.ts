// Cell layout: the stations around the robot, as editable data.
//
// Every station has a position on the floor (x, z in mm, robot base at the
// origin) and a rotation about the vertical axis. Geometry is described in the
// station's local frame and transformed with the same convention three.js uses
// for `rotation.y`, so the 3D view and the simulation always agree.
//
// A station can own a pose (e.g. a bin owns BIN_RED). When the station moves,
// its pose moves with it, so programs keep working after a layout change.

import { forwardKinematics, HOME_JOINTS, isReachable, wrap180 } from './kinematics';
import type { Pose, Vec3 } from './types';

export const PART_SIZE = 50;
const half = PART_SIZE / 2;

export type StationKind = 'conveyor' | 'bin' | 'pallet' | 'machine' | 'tray' | 'table' | 'fence' | 'beacon';

export interface Station {
  id: string;
  kind: StationKind;
  name: string;
  x: number;
  z: number;
  rot: number; // degrees about Y
  pose?: string; // name of the pose this station owns
  // Kind-specific parameters (all optional, see STATION_KINDS defaults).
  length?: number; // conveyor, fence
  size?: number; // bin, pallet
  color?: string; // bin
  rows?: number; // tray
  cols?: number; // tray
  w?: number; // table
  d?: number; // table
  h?: number; // table, fence
  cycle?: number; // machine, seconds
}

export interface CellLayout {
  stations: Station[];
}

// Conveyor and machine constants that are not user-editable.
export const CONVEYOR_WIDTH = 140;
export const CONVEYOR_TOP = 80;
export const CONVEYOR_STOP_INSET = 60; // pick point distance from the discharge end
export const BIN_WALL = 90;
export const BIN_FLOOR = 6;
export const BIN_WALL_THICKNESS = 8;
export const PALLET_TOP = 30;
export const FIXTURE_TOP = 120;
export const TRAY_TOP = 20;
export const TRAY_PITCH = 70;
export const FENCE_THICKNESS = 30;
// The machine guard zone in the machine frame: in front of the fixture by this
// much, and this wide either side.
export const MACHINE_ZONE_FRONT = 80;
export const MACHINE_ZONE_HALF_WIDTH = 450;

export const FLOOR = { halfX: 1300, halfZ: 1100 };

export interface KindInfo {
  label: string;
  description: string;
  unique?: boolean; // at most one per cell
  posePrefix?: string;
  defaults: Partial<Station>;
}

export const STATION_KINDS: Record<StationKind, KindInfo> = {
  conveyor: {
    label: 'Conveyor',
    description: 'Feeds parts to an end stop. DO0 runs every conveyor; DI0 is on when any pick point has a part.',
    posePrefix: 'PICK',
    defaults: { length: 850 },
  },
  bin: {
    label: 'Bin',
    description: 'Open container. Parts dropped inside are counted.',
    posePrefix: 'BIN',
    defaults: { size: 170, color: '#a855f7' },
  },
  pallet: {
    label: 'Pallet',
    description: 'Flat place surface. Its pose is the first corner slot, ready for the Pallet slot block.',
    posePrefix: 'PALLET',
    defaults: { size: 260 },
  },
  machine: {
    label: 'CNC machine',
    description: 'DO1 starts a cycle, DI1 reports done, DI2 is off while the tool is in front of the fixture.',
    unique: true,
    posePrefix: 'MACHINE',
    defaults: { cycle: 4 },
  },
  tray: {
    label: 'Parts tray',
    description: 'Grid of parts loaded at every reset. Good for picking without a conveyor.',
    posePrefix: 'TRAY',
    defaults: { rows: 2, cols: 3 },
  },
  table: {
    label: 'Table',
    description: 'Work surface. Parts can be placed on it; the tool must stay above it.',
    posePrefix: 'TABLE',
    defaults: { w: 400, d: 300, h: 200 },
  },
  fence: {
    label: 'Fence',
    description: 'Obstacle or safety guard. The tool faults if it touches it.',
    defaults: { length: 600, h: 700 },
  },
  beacon: {
    label: 'Stack light',
    description: 'Shows DO2 (green) and DO3 (red).',
    unique: true,
    defaults: {},
  },
};

export const BIN_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#facc15', '#a855f7', '#f97316', '#71717a'];

// ── Frames ──────────────────────────────────────────────────────────────────

export function toWorld(s: Pick<Station, 'x' | 'z' | 'rot'>, lx: number, lz: number): { x: number; z: number } {
  const t = (s.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const n = Math.sin(t);
  return { x: s.x + lx * c + lz * n, z: s.z - lx * n + lz * c };
}

export function toLocal(s: Pick<Station, 'x' | 'z' | 'rot'>, x: number, z: number): { x: number; z: number } {
  const t = (s.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const n = Math.sin(t);
  const dx = x - s.x;
  const dz = z - s.z;
  return { x: dx * c - dz * n, z: dx * n + dz * c };
}

// ── Geometry ────────────────────────────────────────────────────────────────

export function param<K extends keyof Station>(s: Station, key: K): NonNullable<Station[K]> {
  return (s[key] ?? STATION_KINDS[s.kind].defaults[key]) as NonNullable<Station[K]>;
}

// Boxes in the station frame. `top` is the surface height. Solid boxes support
// released parts and fault the tool if it goes inside.
export interface Box {
  cx: number;
  cz: number;
  w: number; // along local x
  d: number; // along local z
  top: number;
}

export function stationBoxes(s: Station): Box[] {
  switch (s.kind) {
    case 'conveyor':
      return [{ cx: 0, cz: 0, w: param(s, 'length'), d: CONVEYOR_WIDTH, top: CONVEYOR_TOP }];
    case 'pallet':
      return [{ cx: 0, cz: 0, w: param(s, 'size'), d: param(s, 'size'), top: PALLET_TOP }];
    case 'machine':
      return [
        { cx: 0, cz: 0, w: 110, d: 110, top: FIXTURE_TOP },
        { cx: -230, cz: 0, w: 220, d: 420, top: 600 },
      ];
    case 'tray': {
      const { w, d } = traySize(s);
      return [{ cx: 0, cz: 0, w, d, top: TRAY_TOP }];
    }
    case 'table':
      return [{ cx: 0, cz: 0, w: param(s, 'w'), d: param(s, 'd'), top: param(s, 'h') }];
    case 'fence':
      return [{ cx: 0, cz: 0, w: param(s, 'length'), d: FENCE_THICKNESS, top: param(s, 'h') }];
    case 'beacon':
      return [{ cx: 0, cz: 0, w: 40, d: 40, top: 480 }];
    case 'bin': {
      // Floor plus four thin walls; the inside is open.
      const size = param(s, 'size');
      const t = BIN_WALL_THICKNESS;
      return [
        { cx: 0, cz: 0, w: size, d: size, top: BIN_FLOOR },
        { cx: 0, cz: size / 2 - t / 2, w: size, d: t, top: BIN_WALL },
        { cx: 0, cz: -size / 2 + t / 2, w: size, d: t, top: BIN_WALL },
        { cx: size / 2 - t / 2, cz: 0, w: t, d: size, top: BIN_WALL },
        { cx: -size / 2 + t / 2, cz: 0, w: t, d: size, top: BIN_WALL },
      ];
    }
  }
}

// Floor footprint (local frame) used for selection, overlap checks and bins.
export function footprint(s: Station): Box {
  switch (s.kind) {
    case 'bin':
      return { cx: 0, cz: 0, w: param(s, 'size'), d: param(s, 'size'), top: BIN_WALL };
    case 'machine':
      return { cx: -142, cz: 0, w: 395, d: 420, top: 600 };
    default:
      return stationBoxes(s)[0];
  }
}

export function inBox(b: Box, lx: number, lz: number, margin = 0): boolean {
  return Math.abs(lx - b.cx) < b.w / 2 + margin && Math.abs(lz - b.cz) < b.d / 2 + margin;
}

export function traySize(s: Station) {
  return { w: param(s, 'cols') * TRAY_PITCH + 30, d: param(s, 'rows') * TRAY_PITCH + 30 };
}

export function traySlots(s: Station): Vec3[] {
  const rows = param(s, 'rows');
  const cols = param(s, 'cols');
  const out: Vec3[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = toWorld(s, (c - (cols - 1) / 2) * TRAY_PITCH, (r - (rows - 1) / 2) * TRAY_PITCH);
      out.push({ x: p.x, y: TRAY_TOP + half, z: p.z });
    }
  }
  return out;
}

// Conveyor feed direction is local +x; parts enter at -length/2.
export function conveyorEnds(s: Station) {
  const L = param(s, 'length');
  return { start: -L / 2, stop: L / 2 - CONVEYOR_STOP_INSET, end: L / 2 };
}

// ── Owned poses ─────────────────────────────────────────────────────────────

// Where a station's own pose sits, in its local frame (y is world height).
export function anchorLocal(s: Station): Vec3 | null {
  switch (s.kind) {
    case 'conveyor':
      return { x: conveyorEnds(s).stop, y: CONVEYOR_TOP + half, z: 0 };
    case 'bin':
      // Release just above the rim; the part drops in and settles.
      return { x: 0, y: BIN_WALL + half + 30, z: 0 };
    case 'pallet':
      return { x: -70, y: PALLET_TOP + half, z: -70 };
    case 'machine':
      return { x: 0, y: FIXTURE_TOP + half, z: 0 };
    case 'tray': {
      const rows = param(s, 'rows');
      const cols = param(s, 'cols');
      return { x: (-(cols - 1) / 2) * TRAY_PITCH, y: TRAY_TOP + half, z: (-(rows - 1) / 2) * TRAY_PITCH };
    }
    case 'table':
      return { x: 0, y: param(s, 'h') + half, z: 0 };
    default:
      return null;
  }
}

// Tool angle for a station's own pose. Conveyor parts queue nose to tail, so
// the fingers must close across the belt, never along it.
export function anchorRz(s: Station): number | undefined {
  return s.kind === 'conveyor' ? wrap180(s.rot + 90) : undefined;
}

export function anchorPose(s: Station): Pose | null {
  const a = anchorLocal(s);
  if (!a || !s.pose) return null;
  const p = toWorld(s, a.x, a.z);
  const rz = anchorRz(s);
  return { name: s.pose, x: Math.round(p.x), y: Math.round(a.y), z: Math.round(p.z), ...(rz !== undefined ? { rz } : {}) };
}

// Moves a pose rigidly from one station placement to another, keeping any
// offset the user taught relative to the station.
export function carryPose(p: Pose, from: Station, to: Station): Pose {
  const l = toLocal(from, p.x, p.z);
  const a0 = anchorLocal(from);
  const a1 = anchorLocal(to);
  // Parameter changes (e.g. a longer conveyor) move the anchor itself.
  const dx = a0 && a1 ? a1.x - a0.x : 0;
  const dz = a0 && a1 ? a1.z - a0.z : 0;
  const dy = a0 && a1 ? a1.y - a0.y : 0;
  const w = toWorld(to, l.x + dx, l.z + dz);
  const rz = typeof p.rz === 'number' ? { rz: wrap180(p.rz + to.rot - from.rot) } : {};
  return { name: p.name, x: Math.round(w.x), y: Math.round(p.y + dy), z: Math.round(w.z), ...rz };
}

// Applies a station edit to the pose list.
export function syncPoses(poses: Pose[], from: Station, to: Station): Pose[] {
  if (!from.pose || from.pose !== to.pose) return poses;
  return poses.map((p) => (p.name === from.pose ? carryPose(p, from, to) : p));
}

export function posesForLayout(layout: CellLayout): Pose[] {
  const home = forwardKinematics(HOME_JOINTS);
  const out: Pose[] = [{ name: 'HOME', x: Math.round(home.x), y: Math.round(home.y), z: Math.round(home.z) }];
  for (const s of layout.stations) {
    const p = anchorPose(s);
    if (p && !out.some((o) => o.name === p.name)) out.push(p);
  }
  return out;
}

// ── Editing helpers ─────────────────────────────────────────────────────────

export function uniquePoseName(base: string, taken: Set<string>): string {
  const clean = base.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'POSE';
  if (!taken.has(clean)) return clean;
  for (let i = 2; ; i++) if (!taken.has(`${clean}_${i}`)) return `${clean}_${i}`;
}

let idCounter = 0;
export function newStationId(kind: StationKind) {
  idCounter = (idCounter + 1) % 1e6;
  return `${kind}-${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function createStation(kind: StationKind, layout: CellLayout, poses: Pose[], at?: { x: number; z: number }): Station {
  const info = STATION_KINDS[kind];
  const count = layout.stations.filter((s) => s.kind === kind).length;
  const name = `${info.label}${count ? ` ${count + 1}` : ''}`;
  const taken = new Set(poses.map((p) => p.name));
  const color = kind === 'bin' ? BIN_COLORS[count % BIN_COLORS.length] : undefined;
  return {
    id: newStationId(kind),
    kind,
    name,
    x: at?.x ?? 350,
    z: at?.z ?? 350,
    rot: 0,
    ...info.defaults,
    ...(color ? { color } : {}),
    ...(info.posePrefix ? { pose: uniquePoseName(count ? `${info.posePrefix}_${count + 1}` : info.posePrefix, taken) } : {}),
  };
}

// Suggests a free floor spot inside the robot's reach for a new station.
export function freeSpot(layout: CellLayout, kind: StationKind): { x: number; z: number } {
  const probe = { ...createStation(kind, { stations: [] }, []), x: 0, z: 0 };
  for (const r of [450, 550, 650, 350, 750, 900]) {
    for (let a = 0; a < 360; a += 30) {
      const x = Math.round((r * Math.sin((a * Math.PI) / 180)) / 10) * 10;
      const z = Math.round((r * Math.cos((a * Math.PI) / 180)) / 10) * 10;
      const s = { ...probe, x, z };
      if (!overlapsAny(s, layout.stations) && !overlapsRobot(s)) return { x, z };
    }
  }
  return { x: 350, z: 350 };
}

// Rotation that points the station's local +x (conveyor flow, machine front)
// at the robot base.
export function faceRobotRotation(s: Station): number {
  const deg = (Math.atan2(s.z, -s.x) * 180) / Math.PI;
  return Math.round(deg);
}

// ── Validation ──────────────────────────────────────────────────────────────

// Do two rectangles on the floor overlap? Each is a centre, a yaw (degrees,
// same convention as station rotation) and its extents along its own x and z.
export interface Rect {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
}
export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  const corners = (r: Rect) => {
    const hw = r.w / 2 + margin / 2;
    const hd = r.d / 2 + margin / 2;
    return [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([lx, lz]) => toWorld({ x: r.x, z: r.z, rot: r.yaw }, lx, lz));
  };
  const pa = corners(a);
  const pb = corners(b);
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const nx = q.z - p.z;
      const nz = p.x - q.x;
      const ra = pa.map((v) => v.x * nx + v.z * nz);
      const rb = pb.map((v) => v.x * nx + v.z * nz);
      if (Math.max(...ra) <= Math.min(...rb) || Math.max(...rb) <= Math.min(...ra)) return false;
    }
  }
  return true;
}

function corners(s: Station, b: Box, margin = 0): { x: number; z: number }[] {
  const hw = b.w / 2 + margin;
  const hd = b.d / 2 + margin;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, z]) => toWorld(s, b.cx + x, b.cz + z));
}

// Separating-axis test between two station footprints.
function overlaps(a: Station, b: Station): boolean {
  const pa = corners(a, footprint(a), -2);
  const pb = corners(b, footprint(b), -2);
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const nx = q.z - p.z;
      const nz = p.x - q.x;
      const proj = (pts: { x: number; z: number }[]) => pts.map((v) => v.x * nx + v.z * nz);
      const ra = proj(pa);
      const rb = proj(pb);
      if (Math.max(...ra) < Math.min(...rb) || Math.max(...rb) < Math.min(...ra)) return false;
    }
  }
  return true;
}

function overlapsAny(s: Station, others: Station[]) {
  return others.some((o) => o.id !== s.id && overlaps(s, o));
}

const ROBOT_BASE_RADIUS = 170;
function overlapsRobot(s: Station): boolean {
  const l = toLocal(s, 0, 0);
  const b = footprint(s);
  const nx = Math.max(Math.abs(l.x - b.cx) - b.w / 2, 0);
  const nz = Math.max(Math.abs(l.z - b.cz) - b.d / 2, 0);
  return Math.hypot(nx, nz) < ROBOT_BASE_RADIUS;
}

export interface LayoutIssue {
  stationId: string;
  severity: 'error' | 'warning';
  message: string;
}

export function validateLayout(layout: CellLayout, poses: Pose[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const stations = layout.stations;
  stations.forEach((s, i) => {
    if (overlapsRobot(s)) issues.push({ stationId: s.id, severity: 'error', message: `${s.name} overlaps the robot base` });
    for (const o of stations.slice(i + 1)) {
      if (overlaps(s, o)) issues.push({ stationId: s.id, severity: 'warning', message: `${s.name} overlaps ${o.name}` });
    }
    if (Math.abs(s.x) > FLOOR.halfX || Math.abs(s.z) > FLOOR.halfZ) {
      issues.push({ stationId: s.id, severity: 'warning', message: `${s.name} is off the floor area` });
    }
    if (s.pose) {
      const p = poses.find((q) => q.name === s.pose);
      if (!p) {
        issues.push({ stationId: s.id, severity: 'warning', message: `${s.name}: pose ${s.pose} was deleted` });
      } else if (!isReachable(p)) {
        issues.push({ stationId: s.id, severity: 'error', message: `${s.name}: the robot cannot reach ${s.pose}` });
      } else if (!isReachable({ ...p, y: p.y + 120 })) {
        issues.push({ stationId: s.id, severity: 'warning', message: `${s.name}: no room to approach ${s.pose} from above` });
      }
    }
  });
  return issues;
}

// ── Presets ─────────────────────────────────────────────────────────────────

const st = (kind: StationKind, name: string, x: number, z: number, extra: Partial<Station> = {}): Station => ({
  id: `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  kind,
  name,
  x,
  z,
  rot: 0,
  ...STATION_KINDS[kind].defaults,
  ...extra,
});

// The original cell: conveyor, four bins, pallet and CNC machine.
export const DEFAULT_LAYOUT: CellLayout = {
  stations: [
    st('conveyor', 'Infeed conveyor', -395, 500, { pose: 'PICK' }),
    st('bin', 'Red', -330, -480, { pose: 'BIN_RED', color: '#ef4444' }),
    st('bin', 'Green', -110, -480, { pose: 'BIN_GREEN', color: '#22c55e' }),
    st('bin', 'Blue', 110, -480, { pose: 'BIN_BLUE', color: '#3b82f6' }),
    st('bin', 'Reject', 330, -480, { pose: 'BIN_REJECT', color: '#71717a' }),
    st('pallet', 'Pallet', 480, 150, { pose: 'PALLET' }),
    st('machine', 'CNC machine', -480, -220, { pose: 'MACHINE' }),
    st('beacon', 'Stack light', -640, 330),
  ],
};

export interface EnvironmentPreset {
  id: string;
  title: string;
  description: string;
  layout: CellLayout;
}

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'full-cell',
    title: 'Full production cell',
    description: 'Conveyor, four sorting bins, pallet and CNC machine. Every template uses this cell.',
    layout: DEFAULT_LAYOUT,
  },
  {
    id: 'sorting-line',
    title: 'Two-lane sorting',
    description: 'Two infeed conveyors and six colour bins in an arc.',
    layout: {
      stations: [
        st('conveyor', 'Infeed A', -420, 470, { pose: 'PICK', length: 700 }),
        st('conveyor', 'Infeed B', 420, 470, { pose: 'PICK_B', length: 700, rot: 180 }),
        ...['Red', 'Green', 'Blue', 'Yellow', 'Purple', 'Reject'].map((name, i) => {
          const a = ((-75 + i * 30) * Math.PI) / 180;
          const x = Math.round(560 * Math.sin(a));
          const z = Math.round(-560 * Math.cos(a));
          const color = ['#ef4444', '#22c55e', '#3b82f6', '#facc15', '#a855f7', '#71717a'][i];
          return st('bin', name, x, z, { pose: `BIN_${name.toUpperCase()}`, color });
        }),
        st('beacon', 'Stack light', 0, 960),
      ],
    },
  },
  {
    id: 'palletizing',
    title: 'Palletizing station',
    description: 'One conveyor feeding two pallets, behind a safety fence.',
    layout: {
      stations: [
        st('conveyor', 'Infeed conveyor', -395, 500, { pose: 'PICK' }),
        st('pallet', 'Pallet A', 480, 150, { pose: 'PALLET' }),
        st('pallet', 'Pallet B', 300, -460, { pose: 'PALLET_B' }),
        st('fence', 'Guard', -700, -200, { rot: 90, length: 900 }),
        st('beacon', 'Stack light', -640, 330),
      ],
    },
  },
  {
    id: 'classroom',
    title: 'Classroom table',
    description: 'A table with a parts tray and two bins. No conveyor or machine to set up.',
    layout: {
      stations: [
        st('table', 'Desk', 0, 520, { pose: 'TABLE', w: 700, d: 280, h: 150 }),
        st('tray', 'Tray', 380, 150, { pose: 'TRAY', rows: 2, cols: 3, rot: 90 }),
        st('bin', 'Red', -380, -300, { pose: 'BIN_RED', color: '#ef4444' }),
        st('bin', 'Blue', -380, 150, { pose: 'BIN_BLUE', color: '#3b82f6' }),
      ],
    },
  },
  {
    id: 'empty',
    title: 'Empty floor',
    description: 'Only the robot. Build your own cell from scratch.',
    layout: { stations: [] },
  },
];

export function cloneLayout(layout: CellLayout): CellLayout {
  return { stations: layout.stations.map((s) => ({ ...s })) };
}

// Accepts anything that looks like a layout (saved programs, imported files).
export function parseLayout(raw: unknown): CellLayout | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as CellLayout).stations)) return null;
  const stations: Station[] = [];
  for (const s of (raw as CellLayout).stations) {
    if (!s || typeof s !== 'object' || !(s.kind in STATION_KINDS)) continue;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    stations.push({
      ...s,
      id: typeof s.id === 'string' && s.id ? s.id : newStationId(s.kind),
      name: typeof s.name === 'string' ? s.name : STATION_KINDS[s.kind].label,
      x: num(s.x, 0),
      z: num(s.z, 0),
      rot: num(s.rot, 0),
    });
  }
  return { stations };
}
