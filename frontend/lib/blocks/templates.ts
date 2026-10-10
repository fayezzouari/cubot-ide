// Ready-to-run programs for industrial and educational use cases.
//
// Templates are written in a compact nested form and laid out automatically
// into a flow graph, so they stay readable here and tidy on the canvas.

import type { Edge, Node } from '@xyflow/react';
import { tidyNodes } from './autolayout';
import { defaultData } from './registry';
import { ENVIRONMENT_PRESETS, type CellLayout } from './layout';
import type { SceneConfig } from './types';
import { DEFAULT_SCENE } from './workcell';

type Step =
  | { t: string; d?: Record<string, unknown> }
  | { if: string; then: Step[]; else?: Step[] }
  | { repeat: number | string; var?: string; body: Step[] }
  | { while: string; body: Step[] };

export interface Template {
  id: string;
  title: string;
  audience: 'industry' | 'education';
  sector: string;
  summary: string;
  // What the program demonstrates / what a learner practises.
  highlights: string[];
  // Industry: how the cell maps to a real line. Education: suggested level.
  context: string;
  scene: SceneConfig;
  // Cell layout; the full production cell when omitted.
  layout?: CellLayout;
  trail?: boolean;
  steps: Step[];
}

const b = (t: string, d?: Record<string, unknown>): Step => ({ t, d });

export const TEMPLATES: Template[] = [
  // ── Industry ──────────────────────────────────────────────────────────────
  {
    id: 'pick-place',
    title: 'Conveyor pick & place',
    audience: 'industry',
    sector: 'Packaging · Food & beverage',
    summary:
      'Takes parts off an accumulating conveyor at the end stop and loads them into a tote. The classic first robot cell in end-of-line packaging.',
    highlights: ['Sensor-triggered picking (DI0)', 'Approach / retract heights', 'Cycle counter & completion light'],
    context: 'Matches a case-packing or tray-loading station: belt feeds parts, a photo-eye at the end stop tells the robot a part is ready.',
    scene: { ...DEFAULT_SCENE, colors: ['blue'], defectRate: 0, maxParts: 6 },
    steps: [
      b('home', { speed: 60 }),
      b('set_output', { channel: '2', value: 'on' }),
      b('conveyor', { action: 'start', speed: 180 }),
      b('set_var', { var: 'packed', value: '0' }),
      {
        repeat: 6,
        var: 'i',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('pick', { pose: 'PICK', approach: 120, speed: 70 }),
          b('place', { pose: 'BIN_BLUE', approach: 140, speed: 70 }),
          b('change_var', { var: 'packed', by: 1 }),
          b('log', { message: 'Packed {packed} of 6' }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home', { speed: 60 }),
      b('set_output', { channel: '2', value: 'off' }),
      b('end'),
    ],
  },
  {
    id: 'vision-sort',
    title: 'Vision quality sorting',
    audience: 'industry',
    sector: 'Quality inspection · Recycling',
    summary:
      'A camera inspects every part at the pick point. Defective parts go to reject, good parts are sorted by colour, and counts are published over MQTT.',
    highlights: ['Vision inspection block', 'Nested if/else decisions', 'MQTT telemetry for a dashboard / MES'],
    context: 'Same structure as colour sorting in recycling, grading in food processing, or end-of-line QC with an automatic reject lane.',
    scene: { ...DEFAULT_SCENE, colors: ['red', 'green', 'blue'], defectRate: 0.2, maxParts: 0 },
    steps: [
      b('home'),
      b('conveyor', { action: 'start', speed: 200 }),
      b('set_var', { var: 'good', value: '0' }),
      b('set_var', { var: 'rejected', value: '0' }),
      {
        repeat: 10,
        var: 'n',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('inspect'),
          b('pick', { pose: 'PICK', speed: 80 }),
          {
            if: 'part_defect',
            then: [b('place', { pose: 'BIN_REJECT', speed: 80 }), b('change_var', { var: 'rejected', by: 1 })],
            else: [
              {
                if: 'part_color == "red"',
                then: [b('place', { pose: 'BIN_RED', speed: 80 })],
                else: [
                  {
                    if: 'part_color == "green"',
                    then: [b('place', { pose: 'BIN_GREEN', speed: 80 })],
                    else: [b('place', { pose: 'BIN_BLUE', speed: 80 })],
                  },
                ],
              },
              b('change_var', { var: 'good', by: 1 }),
            ],
          },
          b('mqtt_publish', {
            topic: 'factory/cell1/quality',
            payload: '{"good": {good}, "rejected": {rejected}, "last": "{part_color}"}',
          }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('log', { message: 'Batch done: {good} good, {rejected} rejected' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'palletizing',
    title: 'Palletizing 3 × 3 × 2',
    audience: 'industry',
    sector: 'Logistics · Warehousing',
    summary:
      'Builds a two-layer pallet from conveyor parts. One taught corner pose plus a Pallet slot block computes every place position.',
    highlights: ['Pattern computed from a slot index', 'Pose + offset (frame) programming', 'Scales to any pallet by changing 6 numbers'],
    context: 'End-of-line palletizing of boxes, bags or crates. Changing the pattern for a new SKU means editing the Pallet slot block, not re-teaching 18 points.',
    scene: { ...DEFAULT_SCENE, colors: ['yellow'], defectRate: 0, maxParts: 18 },
    steps: [
      b('home'),
      b('conveyor', { action: 'start', speed: 220 }),
      {
        repeat: 18,
        var: 'slot',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('pick', { pose: 'PICK', speed: 80 }),
          b('pallet', { index: 'slot', cols: 3, rows: 3, pitch_x: 70, pitch_z: 70, layer_height: 50 }),
          b('place', { pose: 'PALLET', dx: 'pallet_dx', dy: 'pallet_dy', dz: 'pallet_dz', approach: 150, speed: 80 }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('log', { message: 'Pallet complete — call the forklift' }),
      b('mqtt_publish', { topic: 'warehouse/pallet/ready', payload: '{"layers": 2, "cases": 18}' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'machine-tending',
    title: 'CNC machine tending',
    audience: 'industry',
    sector: 'Metalworking · Discrete manufacturing',
    summary:
      'Loads a raw part into the machine, steps out of the machine zone, starts the cycle, waits for the done signal and unloads the finished part.',
    highlights: ['Handshake over digital I/O (DO1 / DI1)', 'Safety interlock: zone-clear input DI2', 'Timeouts that raise alarms'],
    context:
      'Mirrors lathe / mill / injection-moulding tending. The robot and machine exchange start/done signals and the machine refuses to start while the robot is inside it.',
    scene: { ...DEFAULT_SCENE, colors: ['yellow'], defectRate: 0, maxParts: 3 },
    steps: [
      b('home'),
      b('conveyor', { action: 'start', speed: 200 }),
      {
        repeat: 3,
        var: 'job',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('pick', { pose: 'PICK' }),
          b('place', { pose: 'MACHINE', approach: 150 }),
          b('home'),
          b('wait_input', { channel: '2', value: 'on', timeout: 5 }),
          b('set_output', { channel: '1', value: 'on' }),
          b('set_output', { channel: '1', value: 'off' }),
          b('log', { message: 'Machining job {job}…' }),
          b('wait_input', { channel: '1', value: 'on', timeout: 10 }),
          b('pick', { pose: 'MACHINE', approach: 150 }),
          b('place', { pose: 'BIN_GREEN' }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'oee-cell',
    title: 'Production cell with OEE telemetry',
    audience: 'industry',
    sector: 'Industry 4.0 · Smart factory',
    summary:
      'A continuously running cell that measures cycle time per part, streams it over MQTT, drives a stack light and stops with an alarm when quality drifts.',
    highlights: ['Cycle-time measurement with `time`', 'Stack light status (DO2 / DO3)', 'Quality alarm after 3 defects'],
    context: 'The pattern behind OEE dashboards: every cycle publishes performance and quality data to a broker that feeds Grafana, an MES or a historian.',
    scene: { ...DEFAULT_SCENE, colors: ['red', 'blue'], defectRate: 0.25, maxParts: 0 },
    steps: [
      b('home'),
      b('set_output', { channel: '2', value: 'on' }),
      b('conveyor', { action: 'start', speed: 220 }),
      b('set_var', { var: 'count', value: '0' }),
      b('set_var', { var: 'defects', value: '0' }),
      {
        while: 'count < 12',
        body: [
          b('set_var', { var: 't0', value: 'time' }),
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('inspect'),
          b('pick', { pose: 'PICK', speed: 90 }),
          {
            if: 'part_ok',
            then: [b('place', { pose: 'PALLET', dx: '(count % 3) * 70', dz: 'floor(count / 3) % 3 * 70', speed: 90 })],
            else: [b('place', { pose: 'BIN_REJECT', speed: 90 }), b('change_var', { var: 'defects', by: 1 })],
          },
          b('change_var', { var: 'count', by: 1 }),
          b('set_var', { var: 'cycle_s', value: 'round((time - t0) * 10) / 10' }),
          b('mqtt_publish', {
            topic: 'factory/cell2/cycle',
            payload: '{"part": {count}, "cycle_s": {cycle_s}, "ok": {part_ok}, "defects": {defects}}',
          }),
          { if: 'defects >= 3', then: [b('alarm', { message: 'Quality alarm: {defects} defects in {count} parts — check upstream process' })], else: [] },
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('set_output', { channel: '2', value: 'off' }),
      b('home'),
      b('end'),
    ],
  },

  // ── Education ─────────────────────────────────────────────────────────────
  {
    id: 'hello-robot',
    title: 'Hello, robot! — sequencing',
    audience: 'education',
    sector: 'Ages 10+ · First lesson',
    summary: 'Moves the arm through a short sequence and opens / closes the gripper. The tool path is drawn so learners see what each block did.',
    highlights: ['Programs run top to bottom', 'Coordinates: X, Y (up), Z in mm', 'Use Step mode to run one block at a time'],
    context: 'Lesson idea: predict where the arm goes before pressing Run, then change one number and predict again.',
    scene: { ...DEFAULT_SCENE, maxParts: 0, colors: [] },
    trail: true,
    steps: [
      b('home'),
      b('move_position', { x: 300, y: 400, z: 300, mode: 'joint' }),
      b('move_position', { x: -300, y: 400, z: 300, mode: 'joint' }),
      b('move_relative', { dx: 0, dy: -200, dz: 0 }),
      b('gripper', { action: 'close' }),
      b('gripper', { action: 'open' }),
      b('log', { message: 'Hello from the robot at ({tcp_x}, {tcp_y}, {tcp_z})' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'polygon',
    title: 'Draw a polygon — loops & angles',
    audience: 'education',
    sector: 'Ages 12+ · Maths & geometry',
    summary:
      'A Repeat loop draws a regular polygon with the tool. Each side turns by 360° ÷ sides, using sin/cos of the loop counter.',
    highlights: ['Repeat loops and counter variables', 'Variables in expressions', 'Trigonometry: sin / cos in degrees'],
    context: 'Challenge: change `sides` to 3, 6 or 8. What happens with 36 sides? Why does the shape close exactly?',
    scene: { ...DEFAULT_SCENE, maxParts: 0, colors: [] },
    trail: true,
    steps: [
      b('home'),
      b('set_var', { var: 'sides', value: '5' }),
      b('set_var', { var: 'length', value: '180' }),
      b('move_position', { x: -90, y: 150, z: 300, mode: 'linear' }),
      {
        repeat: 'sides',
        var: 'i',
        body: [
          b('move_relative', {
            dx: 'length * cos(360 / sides * i)',
            dy: 0,
            dz: 'length * sin(360 / sides * i)',
            speed: 50,
          }),
        ],
      },
      b('move_relative', { dx: 0, dy: 150, dz: 0 }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'sensor-decisions',
    title: 'Sensors & decisions',
    audience: 'education',
    sector: 'Ages 12+ · Logic',
    summary: 'Waits for the conveyor sensor, asks the camera for the colour, and uses If/else to choose a bin.',
    highlights: ['Wait until a condition is true', 'If / else with comparisons', 'Reading sensor values into variables'],
    context: 'Discuss: what should the robot do with a colour it does not know? Add a yellow bin rule, then turn on yellow parts in Scene settings.',
    scene: { ...DEFAULT_SCENE, colors: ['red', 'blue'], defectRate: 0, maxParts: 5 },
    steps: [
      b('home'),
      b('conveyor', { action: 'start', speed: 200 }),
      {
        repeat: 5,
        var: 'i',
        body: [
          b('wait_until', { condition: 'part_present', timeout: 15 }),
          b('inspect'),
          b('pick', { pose: 'PICK' }),
          {
            if: 'part_color == "red"',
            then: [b('place', { pose: 'BIN_RED' })],
            else: [b('place', { pose: 'BIN_BLUE' })],
          },
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'tower',
    title: 'Build a tower — variables',
    audience: 'education',
    sector: 'Ages 12+ · Variables',
    summary: 'Stacks parts into a tower. A variable remembers the current height so each part is placed one block higher.',
    highlights: ['Create and change variables', 'Offsets relative to a pose', 'Log messages with {placeholders}'],
    context: 'Extension: stop when the tower reaches 200 mm using a While loop instead of Repeat.',
    scene: { ...DEFAULT_SCENE, colors: ['red', 'green', 'blue', 'yellow'], defectRate: 0, maxParts: 4 },
    steps: [
      b('home'),
      b('conveyor', { action: 'start', speed: 220 }),
      b('set_var', { var: 'height', value: '0' }),
      {
        repeat: 4,
        var: 'i',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('pick', { pose: 'PICK' }),
          b('place', { pose: 'STACK', dy: 'height', approach: 120 }),
          b('change_var', { var: 'height', by: 50 }),
          b('log', { message: 'Tower is {height} mm tall' }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'desk-sort',
    title: 'Desk sorting — your own cell',
    audience: 'education',
    sector: 'Ages 10+ · Custom environment',
    summary: 'A classroom desk with a parts tray and two bins. The robot takes each part, checks its colour with the wrist camera and sorts it.',
    highlights: ['Building a cell in the Environment tab', 'Grid offsets with a loop counter', 'Wrist-camera inspection'],
    context:
      'Open the Environment tab: drag the tray or a bin somewhere else and run again — the poses follow the stations. Then add a third bin for green parts.',
    scene: { ...DEFAULT_SCENE, colors: ['red', 'blue'], defectRate: 0, maxParts: 0 },
    layout: ENVIRONMENT_PRESETS.find((e) => e.id === 'classroom')!.layout,
    steps: [
      b('home'),
      {
        repeat: 6,
        var: 'i',
        body: [
          // The tray is turned 90°: rows run along +X, columns along -Z.
          // A high approach keeps the part clear of the desk while the arm swings.
          b('pick', { pose: 'TRAY', dx: 'floor(i / 3) * 70', dz: '0 - (i % 3) * 70', approach: 220 }),
          b('inspect'),
          {
            if: 'part_color == "red"',
            then: [b('place', { pose: 'BIN_RED', approach: 220 })],
            else: [b('place', { pose: 'BIN_BLUE', approach: 220 })],
          },
          b('log', { message: 'Part {i}: {part_color}' }),
        ],
      },
      b('home'),
      b('end'),
    ],
  },
];

// ── Layout ──────────────────────────────────────────────────────────────────

const COL = 280;
const ROW = 96;

interface Exit {
  id: string;
  handle: string;
}

export function buildTemplateGraph(steps: Step[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let seq = 0;
  const id = () => `n${++seq}`;
  const link = (from: Exit, to: string) =>
    edges.push({ id: `e${from.id}-${from.handle}-${to}`, source: from.id, sourceHandle: from.handle, target: to });

  const add = (type: string, x: number, y: number, data?: Record<string, unknown>) => {
    const nid = id();
    nodes.push({ id: nid, type, position: { x: x * COL, y: y * ROW }, data: { ...defaultData(type), ...data } });
    return nid;
  };

  // Lays out a sequence; returns its entry node, dangling exits, width (cols) and height (rows).
  const layout = (list: Step[], x: number, y: number, incoming: Exit[]) => {
    let exits = incoming;
    let row = y;
    let width = 1;
    let entry: string | null = null;
    for (const step of list) {
      let nid: string;
      if ('t' in step) {
        nid = add(step.t, x, row, step.d);
        exits.forEach((e) => link(e, nid));
        exits = step.t === 'end' || step.t === 'alarm' ? [] : [{ id: nid, handle: 'next' }];
        row += 1;
      } else if ('if' in step) {
        nid = add('if', x, row, { condition: step.if });
        exits.forEach((e) => link(e, nid));
        const thenL = layout(step.then, x, row + 1, [{ id: nid, handle: 'true' }]);
        const elseL = layout(step.else ?? [], x + thenL.width, row + 1, [{ id: nid, handle: 'false' }]);
        exits = [...thenL.exits, ...elseL.exits];
        width = Math.max(width, thenL.width + elseL.width);
        row += 1 + Math.max(thenL.height, elseL.height, 0);
      } else {
        const isWhile = 'while' in step;
        nid = isWhile
          ? add('while', x, row, { condition: step.while })
          : add('for', x, row, { count: step.repeat, var: step.var ?? 'i' });
        exits.forEach((e) => link(e, nid));
        const body = layout(step.body, x + 1, row + 1, [{ id: nid, handle: 'body' }]);
        body.exits.forEach((e) => link(e, nid));
        exits = [{ id: nid, handle: 'next' }];
        width = Math.max(width, 1 + body.width);
        row += 1 + body.height;
      }
      entry ??= nid;
    }
    // Empty branch: pass the incoming exits straight through.
    return { entry, exits, width, height: row - y };
  };

  const start = add('start', 0, 0);
  layout(steps, 0, 1, [{ id: start, handle: 'next' }]);
  // Final positions account for each node's rendered height.
  return { nodes: tidyNodes(nodes, edges), edges };
}
