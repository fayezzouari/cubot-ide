import type {
  Algorithm,
  BackgroundPreset,
  Drone,
  Robot,
  Task,
  TaskStatus,
  TypeMeta,
  Vda5050Type,
} from './types';

export const FLEET_MQTT_URL = process.env.NEXT_PUBLIC_FLEET_MQTT_URL || 'ws://localhost:9011';

export const FLEET_COLORS = {
  ok: '#34d399',
  accent: '#a78bfa',
  command: '#60a5fa',
  live: '#fb923c',
  error: '#f87171',
  warn: '#fbbf24',
  dim: 'rgba(255, 255, 255, 0.32)',
  faint: 'rgba(255, 255, 255, 0.12)',
  text: 'rgba(255, 255, 255, 0.85)',
  ink: '#0a0a0a',
} as const;

export const ENTITY_PALETTE = ['#34d8a4', '#a78bfa', '#e0a06d', '#60a5fa', '#f472b6', '#facc15'];

export const ROBOT_STATUS_COLOR: Record<Robot['status'], string> = {
  idle: FLEET_COLORS.dim,
  moving: FLEET_COLORS.ok,
  working: FLEET_COLORS.accent,
};

export const DRONE_STATUS_COLOR: Record<Drone['status'], string> = {
  idle: FLEET_COLORS.dim,
  flying: FLEET_COLORS.ok,
  hovering: FLEET_COLORS.accent,
  charging: FLEET_COLORS.warn,
  working: FLEET_COLORS.accent,
};

export const TASK_STATUS_COLOR: Record<Task['status'], string> = {
  pending: FLEET_COLORS.dim,
  assigned: FLEET_COLORS.accent,
  done: FLEET_COLORS.ok,
};

export const TASK_MARKER_COLOR: Record<TaskStatus, string> = {
  pending: '#737373',
  assigned: '#a78bfa',
  done: '#34d399',
};

export const ASSIGNMENT_REASON_COLOR: Record<string, string> = {
  assigned: FLEET_COLORS.ok,
  reassigned: FLEET_COLORS.command,
  late: FLEET_COLORS.error,
  unassigned: FLEET_COLORS.dim,
};

export interface BackgroundPresetDef {
  id: BackgroundPreset;
  label: string;
  swatch: string;
  texture: 'none' | 'crosshatch' | 'speckle' | 'stripes' | 'grain';
  surface: string;
  accent: string;
  grid: string;
  border: string;
  obstacle: string;
  wall: string;
  fog: string;
}

export const BACKGROUND_PRESETS: BackgroundPresetDef[] = [
  {
    id: 'warehouse',
    label: 'Grey',
    swatch: '#6e7075',
    texture: 'none',
    surface: '#64666b',
    accent: '#72747a',
    grid: '#75777d',
    border: '#9b9da3',
    obstacle: '#3c3e43',
    wall: '#505257',
    fog: '#4a4c50',
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    swatch: '#10233b',
    texture: 'crosshatch',
    surface: '#0b1626',
    accent: '#1e3b60',
    grid: '#16304f',
    border: '#3b6ea5',
    obstacle: '#1f3d63',
    wall: '#0d1a2c',
    fog: '#070d17',
  },
  {
    id: 'concrete',
    label: 'Concrete',
    swatch: '#26262a',
    texture: 'speckle',
    surface: '#1b1b1d',
    accent: '#3a3a3f',
    grid: '#29292c',
    border: '#46464b',
    obstacle: '#4d4d53',
    wall: '#242427',
    fog: '#0c0c0d',
  },
  {
    id: 'hazard',
    label: 'Hazard',
    swatch: '#a16207',
    texture: 'stripes',
    surface: '#15130b',
    accent: '#facc15',
    grid: '#2a2614',
    border: '#eab308',
    obstacle: '#7c2d12',
    wall: '#2e270a',
    fog: '#0b0a06',
  },
  {
    id: 'sand',
    label: 'Sand',
    swatch: '#5c4a2c',
    texture: 'grain',
    surface: '#1c1710',
    accent: '#6b5533',
    grid: '#2d2518',
    border: '#6b5533',
    obstacle: '#4f3e25',
    wall: '#2a2216',
    fog: '#0d0b07',
  },
];

export const DEFAULT_BACKGROUND: BackgroundPreset = 'warehouse';

export const WALL_THICKNESS = 1;
export const WALL_HEIGHT = 1.6;

export function getBackgroundPreset(id: BackgroundPreset | undefined): BackgroundPresetDef {
  return BACKGROUND_PRESETS.find((p) => p.id === id) ?? BACKGROUND_PRESETS[0];
}

export const ALGORITHMS: { value: Algorithm; label: string }[] = [
  { value: 'astar', label: 'A*' },
  { value: 'dijkstra', label: 'Dijkstra' },
  { value: 'theta_star', label: 'Theta*' },
];

export const SIM_SPEEDS = [0.5, 1, 1.5, 3] as const;
export const DEFAULT_SIM_SPEED = Number(process.env.NEXT_PUBLIC_FLEET_SIM_SPEED) || 1.5;

export const SEP_RADIUS = 2.4;
export const SEP_WEIGHT = 2.2;
export const BODY_RADIUS = 0.6;
export const MIN_GAP = BODY_RADIUS * 2 + 0.1;

export const ROBOT_MODEL_URL = process.env.NEXT_PUBLIC_FLEET_ROBOT_MODEL_URL || '/fleet/models/ldraw/car.mpd';
export const ROBOT_MODEL_SIZE = 1.4;
export const ROBOT_MODEL_YAW = 0;

export const UAGV_ROOT = 'uagv';
export const VDA_MAJOR = 2;
export const VDA_VERSION = '2.0.0';
export const VDA_MANUFACTURER = 'cubot';
export const CELL_SIZE_M = 1.0;
export const VDA_PUBLISH_MS = 200;

export const UAV_ROOT = 'uav';
export const UAV_MAJOR = 1;
export const UAV_VERSION = '1.0.0';

export const TYPE_META: Record<Vda5050Type, TypeMeta> = {
  order: { dir: 'down', color: FLEET_COLORS.command, label: 'order' },
  instantActions: { dir: 'down', color: FLEET_COLORS.accent, label: 'instantActions' },
  state: { dir: 'up', color: FLEET_COLORS.ok, label: 'state' },
  visualization: { dir: 'up', color: FLEET_COLORS.dim, label: 'visualization' },
  connection: { dir: 'up', color: '#e5e5e5', label: 'connection' },
  factsheet: { dir: 'up', color: '#f472b6', label: 'factsheet' },
};

export const VDA_TYPE_ORDER: Vda5050Type[] = ['order', 'instantActions', 'state', 'visualization', 'connection', 'factsheet'];

export const LOGGED_VDA_TYPES: Vda5050Type[] = ['order', 'instantActions', 'connection', 'factsheet'];
export const VDA_LOG_LIMIT = 60;
export const EDGE_ACTIVE_MS = 850;

export const FEED_LIMIT = 40;

export const STALE_MS = 4000;
export const TELEMETRY_FLUSH_MS = 100;
