// Single source of truth for every block: palette entry, inspector fields,
// output ports and node summary. The compiler, interpreter and code
// generators all key off `type`.

import type { BlockDef, CategoryDef, CategoryId, FieldDef } from './types';

export const CATEGORIES: CategoryDef[] = [
  { id: 'flow', name: 'Flow control', accent: '#38bdf8' },
  { id: 'motion', name: 'Motion', accent: '#a78bfa' },
  { id: 'tool', name: 'Gripper & pick', accent: '#f472b6' },
  { id: 'io', name: 'I/O & conveyor', accent: '#fbbf24' },
  { id: 'sensing', name: 'Sensing & vision', accent: '#34d399' },
  { id: 'data', name: 'Data & logic', accent: '#fb923c' },
  { id: 'comms', name: 'Connectivity', accent: '#60a5fa' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  CategoryDef
>;

export const DIGITAL_OUTPUTS = [
  { value: '0', label: 'DO0 · Conveyor run' },
  { value: '1', label: 'DO1 · Machine cycle start' },
  { value: '2', label: 'DO2 · Stack light green' },
  { value: '3', label: 'DO3 · Stack light red' },
];

export const DIGITAL_INPUTS = [
  { value: '0', label: 'DI0 · Part at pick point' },
  { value: '1', label: 'DI1 · Machine cycle done' },
  { value: '2', label: 'DI2 · Machine door closed' },
  { value: '3', label: 'DI3 · Operator start button' },
];

const speed: FieldDef = { key: 'speed', label: 'Speed', kind: 'number', default: 60, unit: '%' };
const moveMode: FieldDef = {
  key: 'mode',
  label: 'Path',
  kind: 'select',
  default: 'joint',
  options: [
    { value: 'joint', label: 'Joint (fastest, curved path)' },
    { value: 'linear', label: 'Linear (straight TCP path)' },
  ],
  help: 'Joint moves interpolate axis angles. Linear moves keep the tool on a straight line, which is safer near fixtures.',
};
const offsets: FieldDef[] = [
  { key: 'dx', label: 'Offset X', kind: 'number', default: 0, unit: 'mm' },
  { key: 'dy', label: 'Offset Y (up)', kind: 'number', default: 0, unit: 'mm' },
  { key: 'dz', label: 'Offset Z', kind: 'number', default: 0, unit: 'mm' },
];
const approach: FieldDef = {
  key: 'approach',
  label: 'Approach height',
  kind: 'number',
  default: 120,
  unit: 'mm',
  help: 'The tool first moves this far above the target, then descends in a straight line.',
};

const s = (v: unknown) => (v === undefined || v === '' ? '?' : String(v));
const offsetSummary = (d: Record<string, unknown>) => {
  const parts = ['dx', 'dy', 'dz']
    .filter((k) => d[k] !== undefined && String(d[k]) !== '0' && d[k] !== '')
    .map((k) => `${k}=${d[k]}`);
  return parts.length ? ` + (${parts.join(', ')})` : '';
};

export const BLOCKS: BlockDef[] = [
  // ── Flow ────────────────────────────────────────────────────────────────
  {
    type: 'start',
    label: 'Start',
    category: 'flow',
    description: 'Entry point. Every program has exactly one Start block.',
    fields: [],
    outputs: [{ id: 'next' }],
    hasInput: false,
  },
  {
    type: 'end',
    label: 'End',
    category: 'flow',
    description: 'Stops the program normally.',
    fields: [],
    outputs: [],
    hasInput: true,
  },
  {
    type: 'if',
    label: 'If / else',
    category: 'flow',
    description:
      'Runs the "true" branch when the condition holds, otherwise the "false" branch. Both branches continue at the first block they share.',
    fields: [
      { key: 'condition', label: 'Condition', kind: 'expr', default: 'part_present', placeholder: 'part_color == "red"' },
    ],
    outputs: [
      { id: 'true', label: 'true' },
      { id: 'false', label: 'false' },
    ],
    hasInput: true,
    summary: (d) => `if ${s(d.condition)}`,
  },
  {
    type: 'for',
    label: 'Repeat',
    category: 'flow',
    description:
      'Runs the "loop" branch a fixed number of times, then continues from "done". The counter variable counts from 0.',
    fields: [
      { key: 'count', label: 'Times', kind: 'number', default: 3 },
      { key: 'var', label: 'Counter variable', kind: 'ident', default: 'i' },
    ],
    outputs: [
      { id: 'body', label: 'loop' },
      { id: 'next', label: 'done' },
    ],
    hasInput: true,
    summary: (d) => `${s(d.count)}× (${s(d.var)} = 0…)`,
  },
  {
    type: 'while',
    label: 'While',
    category: 'flow',
    description: 'Repeats the "loop" branch while the condition is true. Use `true` for a production loop that runs until stopped.',
    fields: [{ key: 'condition', label: 'Condition', kind: 'expr', default: 'true' }],
    outputs: [
      { id: 'body', label: 'loop' },
      { id: 'next', label: 'done' },
    ],
    hasInput: true,
    summary: (d) => `while ${s(d.condition)}`,
  },
  {
    type: 'wait_until',
    label: 'Wait until',
    category: 'flow',
    description: 'Pauses until the condition becomes true. Raises an alarm on timeout (0 = wait forever).',
    fields: [
      { key: 'condition', label: 'Condition', kind: 'expr', default: 'part_present' },
      { key: 'timeout', label: 'Timeout', kind: 'number', default: 10, unit: 's' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `${s(d.condition)} (≤ ${s(d.timeout)} s)`,
  },
  {
    type: 'delay',
    label: 'Wait',
    category: 'flow',
    description: 'Pauses for a fixed time.',
    fields: [{ key: 'seconds', label: 'Duration', kind: 'number', default: 1, unit: 's' }],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `${s(d.seconds)} s`,
  },
  {
    type: 'alarm',
    label: 'Raise alarm',
    category: 'flow',
    description: 'Stops the program with an error, turns the red stack light on and records the message.',
    fields: [{ key: 'message', label: 'Message', kind: 'text', default: 'Fault: {part_color} part rejected' }],
    outputs: [],
    hasInput: true,
    summary: (d) => s(d.message),
  },

  // ── Motion ──────────────────────────────────────────────────────────────
  {
    type: 'move_pose',
    label: 'Move to pose',
    category: 'motion',
    description: 'Moves the tool to a taught pose, optionally shifted by an offset. Teach poses in the Poses tab.',
    fields: [{ key: 'pose', label: 'Pose', kind: 'pose', default: 'HOME' }, moveMode, speed, ...offsets],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `${s(d.pose)}${offsetSummary(d)} · ${d.mode === 'linear' ? 'linear' : 'joint'} ${s(d.speed)}%`,
  },
  {
    type: 'move_position',
    label: 'Move to XYZ',
    category: 'motion',
    description: 'Moves the tool tip to absolute coordinates in millimetres (Y is up). Fields accept expressions.',
    fields: [
      { key: 'x', label: 'X', kind: 'number', default: 0, unit: 'mm' },
      { key: 'y', label: 'Y (up)', kind: 'number', default: 300, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 500, unit: 'mm' },
      moveMode,
      speed,
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `(${s(d.x)}, ${s(d.y)}, ${s(d.z)}) mm`,
  },
  {
    type: 'move_relative',
    label: 'Move relative',
    category: 'motion',
    description: 'Shifts the tool from where it is now, in a straight line.',
    fields: [
      { key: 'dx', label: 'ΔX', kind: 'number', default: 0, unit: 'mm' },
      { key: 'dy', label: 'ΔY (up)', kind: 'number', default: 50, unit: 'mm' },
      { key: 'dz', label: 'ΔZ', kind: 'number', default: 0, unit: 'mm' },
      { ...speed, default: 40 },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `Δ(${s(d.dx)}, ${s(d.dy)}, ${s(d.dz)}) mm`,
  },
  {
    type: 'move_joint',
    label: 'Move joint',
    category: 'motion',
    description: 'Moves a single axis to an absolute angle. Useful for teaching and for wrist rotations.',
    fields: [
      {
        key: 'joint',
        label: 'Joint',
        kind: 'select',
        default: '1',
        options: ['1', '2', '3', '4', '5', '6'].map((j) => ({ value: j, label: `J${j}` })),
      },
      { key: 'angle', label: 'Angle', kind: 'number', default: 0, unit: '°' },
      speed,
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `J${s(d.joint)} → ${s(d.angle)}°`,
  },
  {
    type: 'home',
    label: 'Go home',
    category: 'motion',
    description: 'Moves all axes to the home position. Start and end every cycle here.',
    fields: [speed],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `${s(d.speed)}%`,
  },
  {
    type: 'get_position',
    label: 'Read TCP position',
    category: 'motion',
    description: 'Stores the current tool position into <prefix>_x, <prefix>_y and <prefix>_z.',
    fields: [{ key: 'prefix', label: 'Variable prefix', kind: 'ident', default: 'pos' }],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `→ ${s(d.prefix)}_x/y/z`,
  },

  // ── Tool ────────────────────────────────────────────────────────────────
  {
    type: 'pick',
    label: 'Pick',
    category: 'tool',
    description:
      'Complete pick sequence: open gripper, approach above the target, descend linearly, close, retract. Sets `holding` when a part was gripped.',
    fields: [{ key: 'pose', label: 'Pose', kind: 'pose', default: 'PICK' }, ...offsets, approach, speed],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `at ${s(d.pose)}${offsetSummary(d)}`,
  },
  {
    type: 'place',
    label: 'Place',
    category: 'tool',
    description: 'Complete place sequence: approach above the target, descend linearly, open, retract.',
    fields: [{ key: 'pose', label: 'Pose', kind: 'pose', default: 'PLACE' }, ...offsets, approach, speed],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `at ${s(d.pose)}${offsetSummary(d)}`,
  },
  {
    type: 'gripper',
    label: 'Gripper',
    category: 'tool',
    description: 'Opens or closes the gripper. Closing near a part grips it.',
    fields: [
      {
        key: 'action',
        label: 'Action',
        kind: 'select',
        default: 'close',
        options: [
          { value: 'open', label: 'Open' },
          { value: 'close', label: 'Close' },
        ],
      },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => (d.action === 'open' ? 'open' : 'close'),
  },

  // ── I/O ─────────────────────────────────────────────────────────────────
  {
    type: 'conveyor',
    label: 'Conveyor',
    category: 'io',
    description: 'Starts or stops the infeed conveyor (drives DO0). Parts stop at the end stop and trigger DI0.',
    fields: [
      {
        key: 'action',
        label: 'Action',
        kind: 'select',
        default: 'start',
        options: [
          { value: 'start', label: 'Start' },
          { value: 'stop', label: 'Stop' },
        ],
      },
      { key: 'speed', label: 'Belt speed', kind: 'number', default: 150, unit: 'mm/s' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => (d.action === 'stop' ? 'stop' : `start · ${s(d.speed)} mm/s`),
  },
  {
    type: 'set_output',
    label: 'Set output',
    category: 'io',
    description: 'Switches a digital output on or off.',
    fields: [
      { key: 'channel', label: 'Output', kind: 'select', default: '2', options: DIGITAL_OUTPUTS },
      {
        key: 'value',
        label: 'State',
        kind: 'select',
        default: 'on',
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
      },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `DO${s(d.channel)} = ${d.value === 'off' ? 'off' : 'on'}`,
  },
  {
    type: 'wait_input',
    label: 'Wait for input',
    category: 'io',
    description: 'Waits until a digital input reaches the given state. Raises an alarm on timeout (0 = forever).',
    fields: [
      { key: 'channel', label: 'Input', kind: 'select', default: '0', options: DIGITAL_INPUTS },
      {
        key: 'value',
        label: 'State',
        kind: 'select',
        default: 'on',
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
      },
      { key: 'timeout', label: 'Timeout', kind: 'number', default: 15, unit: 's' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `DI${s(d.channel)} = ${d.value === 'off' ? 'off' : 'on'}`,
  },

  // ── Sensing ─────────────────────────────────────────────────────────────
  {
    type: 'inspect',
    label: 'Vision inspect',
    category: 'sensing',
    description:
      'Takes a camera image of the part at a conveyor pick point, or of the part in the gripper when no part is waiting. Sets `part_color` ("red", "green", "blue", "yellow" or "none"), `part_defect` (true/false) and `part_ok`.',
    fields: [],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: () => '→ part_color, part_defect, part_ok',
  },
  {
    type: 'read_input',
    label: 'Read input',
    category: 'sensing',
    description: 'Stores the state of a digital input in a variable.',
    fields: [
      { key: 'channel', label: 'Input', kind: 'select', default: '0', options: DIGITAL_INPUTS },
      { key: 'var', label: 'Variable', kind: 'ident', default: 'sensor' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `DI${s(d.channel)} → ${s(d.var)}`,
  },

  // ── Data ────────────────────────────────────────────────────────────────
  {
    type: 'set_var',
    label: 'Set variable',
    category: 'data',
    description: 'Assigns the value of an expression to a variable.',
    fields: [
      { key: 'var', label: 'Variable', kind: 'ident', default: 'count' },
      { key: 'value', label: 'Value', kind: 'expr', default: '0' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `${s(d.var)} = ${s(d.value)}`,
  },
  {
    type: 'change_var',
    label: 'Change variable',
    category: 'data',
    description: 'Adds a value to a numeric variable (use a negative number to subtract).',
    fields: [
      { key: 'var', label: 'Variable', kind: 'ident', default: 'count' },
      { key: 'by', label: 'By', kind: 'number', default: 1 },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `${s(d.var)} += ${s(d.by)}`,
  },
  {
    type: 'pallet',
    label: 'Pallet slot',
    category: 'data',
    description:
      'Computes the offset of slot `index` in a rows × columns × layers pattern and stores it in pallet_dx, pallet_dy, pallet_dz. Use these as offsets of a Place block.',
    fields: [
      { key: 'index', label: 'Slot index', kind: 'number', default: 'i' },
      { key: 'cols', label: 'Columns (X)', kind: 'number', default: 3 },
      { key: 'rows', label: 'Rows (Z)', kind: 'number', default: 3 },
      { key: 'pitch_x', label: 'Pitch X', kind: 'number', default: 70, unit: 'mm' },
      { key: 'pitch_z', label: 'Pitch Z', kind: 'number', default: 70, unit: 'mm' },
      { key: 'layer_height', label: 'Layer height', kind: 'number', default: 50, unit: 'mm' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `slot ${s(d.index)} of ${s(d.cols)}×${s(d.rows)}`,
  },
  {
    type: 'log',
    label: 'Log message',
    category: 'data',
    description: 'Writes a line to the console. Use {name} to insert variable values.',
    fields: [{ key: 'message', label: 'Message', kind: 'text', default: 'Cycle {count} done' }],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => `“${s(d.message)}”`,
  },

  // ── Connectivity ────────────────────────────────────────────────────────
  {
    type: 'mqtt_publish',
    label: 'MQTT publish',
    category: 'comms',
    description:
      'Publishes a message to an MQTT broker (shown in the Telemetry tab while simulating; real broker in exported Python). Use {name} placeholders.',
    fields: [
      { key: 'topic', label: 'Topic', kind: 'text', default: 'factory/cell1/count' },
      { key: 'payload', label: 'Payload', kind: 'text', default: '{"count": {count}}' },
    ],
    outputs: [{ id: 'next' }],
    hasInput: true,
    summary: (d) => s(d.topic),
  },
];

export const BLOCK_BY_TYPE: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.type, b]));

export function defaultData(type: string): Record<string, unknown> {
  const def = BLOCK_BY_TYPE[type];
  if (!def) return {};
  return Object.fromEntries(def.fields.map((f) => [f.key, f.default]));
}

// Fields shown (and editable) directly on a canvas node: the first two, plus
// any other field the user changed from its default. Capped so nodes stay small.
export const MAX_INLINE_FIELDS = 4;
export function inlineFields(def: BlockDef, data: Record<string, unknown>): { shown: FieldDef[]; hidden: number } {
  const shown = def.fields
    .filter((f, i) => i < 2 || String(data[f.key] ?? f.default) !== String(f.default))
    .slice(0, MAX_INLINE_FIELDS);
  return { shown, hidden: def.fields.length - shown.length };
}

// Rendered node height in px; FlowNode uses the same metrics, and auto-layout
// uses this to space nodes.
export const NODE_METRICS = { width: 248, header: 40, row: 26, more: 18, outputs: 20, pad: 8, pill: 40 };
export function nodeHeight(type: string, data: Record<string, unknown>): number {
  const def = BLOCK_BY_TYPE[type];
  if (!def) return NODE_METRICS.header;
  if (def.fields.length === 0 && def.outputs.length <= 1) return NODE_METRICS.pill;
  const { shown, hidden } = inlineFields(def, data);
  const m = NODE_METRICS;
  return m.header + shown.length * m.row + (hidden ? m.more : 0) + (def.outputs.length > 1 ? m.outputs : 0) + m.pad;
}

// Variables that always exist while a program runs. Shown in the Watch panel
// and accepted by the compiler without a prior assignment.
export const BUILTIN_VARIABLES: { name: string; help: string }[] = [
  { name: 'time', help: 'Seconds since the program started' },
  { name: 'tcp_x', help: 'Tool X position (mm)' },
  { name: 'tcp_y', help: 'Tool Y position (mm, up)' },
  { name: 'tcp_z', help: 'Tool Z position (mm)' },
  { name: 'holding', help: 'True while the gripper holds a part' },
  { name: 'part_present', help: 'DI0: a part waits at the pick point' },
  { name: 'machine_done', help: 'DI1: the machine finished its cycle' },
  { name: 'di0', help: 'Digital input 0' },
  { name: 'di1', help: 'Digital input 1' },
  { name: 'di2', help: 'Digital input 2' },
  { name: 'di3', help: 'Digital input 3' },
  { name: 'part_color', help: 'Last vision result' },
  { name: 'part_defect', help: 'Last vision result' },
  { name: 'part_ok', help: 'Last vision result' },
  { name: 'pallet_dx', help: 'Last Pallet slot result' },
  { name: 'pallet_dy', help: 'Last Pallet slot result' },
  { name: 'pallet_dz', help: 'Last Pallet slot result' },
];

// Old block types saved by the previous Blocks editor.
export function migrateLegacyNode(type: string, data: Record<string, unknown>): { type: string; data: Record<string, unknown> } {
  switch (type) {
    case 'ifelse':
      return { type: 'if', data: { ...defaultData('if'), ...data } };
    case 'delay':
      if (data.ms !== undefined && data.seconds === undefined) {
        return { type, data: { ...data, seconds: Number(data.ms) / 1000 } };
      }
      return { type, data: { ...defaultData(type), ...data } };
    case 'millis':
      return { type: 'set_var', data: { var: 'now_ms', value: 'time * 1000' } };
    default:
      return { type, data: { ...defaultData(type), ...data } };
  }
}
