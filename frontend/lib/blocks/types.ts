// Shared types for the CuBot Blocks automation IDE.
//
// A program is a flow graph (React Flow nodes + edges). Before it runs or is
// exported, the graph is compiled into a structured AST (see compiler.ts), so
// the simulator, the hardware driver and every code generator share one set of
// semantics.

import type { CellLayout } from './layout';
import type { VisionConfig } from './vision';

export type FieldKind =
  | 'number' // numeric literal or expression, e.g. `120` or `pallet_x + 10`
  | 'expr' // boolean / numeric expression, e.g. `part_color == "red"`
  | 'text' // free text; `{var}` placeholders are interpolated at runtime
  | 'ident' // variable name
  | 'select'
  | 'pose'; // name of a taught pose

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  default: string | number;
  unit?: string;
  options?: FieldOption[];
  placeholder?: string;
  help?: string;
}

export interface PortDef {
  id: string;
  label?: string;
}

export type CategoryId =
  | 'flow'
  | 'motion'
  | 'tool'
  | 'io'
  | 'sensing'
  | 'data'
  | 'comms';

export interface BlockDef {
  type: string;
  label: string;
  category: CategoryId;
  description: string;
  fields: FieldDef[];
  // Output ports. `next` is the default sequential output.
  outputs: PortDef[];
  hasInput: boolean;
  // One-line summary shown on the collapsed node, built from field values.
  summary?: (data: Record<string, unknown>) => string;
}

export interface CategoryDef {
  id: CategoryId;
  name: string;
  accent: string; // hex colour used for node accents / minimap
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// A taught position: TCP coordinates in millimetres (Y is up) plus the joint
// solution captured when it was taught.
export interface Pose {
  name: string;
  x: number;
  y: number;
  z: number;
  // Tool angle about the vertical axis (degrees): the direction the gripper
  // fingers close along, 0 = world X. Omitted: keep the current tool angle.
  rz?: number | null;
}

export type PartColor = 'red' | 'green' | 'blue' | 'yellow';

export interface SceneConfig {
  // Colours spawned on the conveyor, picked uniformly at random.
  colors: PartColor[];
  // Probability that a spawned part carries a visible defect.
  defectRate: number;
  // Minimum gap between spawned parts on the belt, in mm.
  spacing: number;
  // Stop spawning after this many parts (0 = unlimited).
  maxParts: number;
}

export interface ProgramSettings {
  scene: SceneConfig;
  // Stations around the robot (layout.ts). Older programs have none and use
  // the default cell.
  layout?: CellLayout;
  // Camera colour detection settings (vision.ts); defaults when omitted.
  vision?: VisionConfig;
}

export interface ProgramDocument {
  version: 2;
  name: string;
  poses: Pose[];
  settings: ProgramSettings;
}
