import { HOME_JOINTS, forwardKinematics } from './kinematics';
import { footprint, inBox, PALLET_TOP, PART_SIZE, posesForLayout, STATION_KINDS, toLocal, type CellLayout, type Station, type StationKind } from './layout';
import type { RunResult } from './interpreter';
import type { Step } from './templates';
import type { PartColor, Pose, SceneConfig } from './types';
import { DEFAULT_SCENE, type Part, type World } from './workcell';

export type MissionLevel = 'easy' | 'intermediate' | 'hard';

export type MissionCheck =
  | { type: 'finished' }
  | { type: 'bin'; pose: string; count: number; color?: PartColor; machined?: boolean }
  | { type: 'bin_sorted'; pose: string; accept: PartColor | 'defect' }
  | { type: 'parts_in_bins'; count: number }
  | { type: 'pallet'; count: number; layers?: number }
  | { type: 'stack'; pose: string; count: number }
  | { type: 'visit'; poses: string[] }
  | { type: 'home' }
  | { type: 'output'; channel: number; value: boolean }
  | { type: 'telemetry'; topic: string; count: number }
  | { type: 'time'; seconds: number };

export interface MissionObjective {
  id: string;
  label: string;
  check: MissionCheck;
}

export interface Mission {
  id: string;
  level: MissionLevel;
  title: string;
  summary: string;
  brief: string[];
  concepts: string[];
  blocks: string[];
  layout: CellLayout;
  extraPoses?: Pose[];
  scene: SceneConfig;
  starter: Step[];
  objectives: MissionObjective[];
  hints: string[];
  solution: Step[];
}

export interface MissionRun {
  result: RunResult;
  time: number;
  telemetry: { topic: string }[];
  visits: string[];
}

export interface ObjectiveResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export const MISSION_LEVELS: { id: MissionLevel; label: string; description: string }[] = [
  { id: 'easy', label: 'Easy', description: 'One idea at a time: poses, pick and place, waiting for a sensor.' },
  { id: 'intermediate', label: 'Intermediate', description: 'Loops, variables, offsets, vision and I/O handshakes.' },
  { id: 'hard', label: 'Hard', description: 'Full cells: several rules at once, telemetry, patterns and a time limit.' },
];

const station = (kind: StationKind, name: string, x: number, z: number, extra: Partial<Station> = {}): Station => ({
  id: `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  kind,
  name,
  x,
  z,
  rot: 0,
  ...STATION_KINDS[kind].defaults,
  ...extra,
});

const b = (t: string, d?: Record<string, unknown>): Step => ({ t, d });

const RED = '#ef4444';
const GREEN = '#22c55e';
const BLUE = '#3b82f6';
const YELLOW = '#facc15';
const GREY = '#71717a';

export const MISSIONS: Mission[] = [
  {
    id: 'first-pick',
    level: 'easy',
    title: 'First pick',
    summary: 'Move the only part on the tray into the green bin.',
    brief: [
      'A single part waits on the tray in front of the robot. Put it in the green bin.',
      'The tray owns the pose TRAY and the bin owns BIN_GOAL. A Pick block does the whole grab for you: open, approach from above, descend, close and lift. A Place block does the same in reverse.',
      'Start and finish at home so the arm is out of the way for the next job.',
    ],
    concepts: ['Sequencing', 'Poses', 'Pick & place'],
    blocks: ['home', 'pick', 'place', 'end'],
    layout: {
      stations: [
        station('tray', 'Tray', 430, 220, { pose: 'TRAY', rows: 1, cols: 1 }),
        station('bin', 'Goal', -400, 250, { pose: 'BIN_GOAL', color: GREEN }),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['blue'], defectRate: 0, maxParts: 0 },
    starter: [],
    objectives: [
      { id: 'binned', label: 'The part is in the green bin', check: { type: 'bin', pose: 'BIN_GOAL', count: 1 } },
      { id: 'home', label: 'The robot ends at home', check: { type: 'home' } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Connect Start → Go home → Pick → Place → Go home → End.',
      'Set the Pick block\'s pose to TRAY and the Place block\'s pose to BIN_GOAL.',
    ],
    solution: [b('home'), b('pick', { pose: 'TRAY' }), b('place', { pose: 'BIN_GOAL' }), b('home'), b('end')],
  },
  {
    id: 'checkpoints',
    level: 'easy',
    title: 'Checkpoint tour',
    summary: 'Touch three pedestals in the right order: A, then B, then C.',
    brief: [
      'Three pedestals stand around the robot, each with a checkpoint pose hovering 60 mm above its top: POINT_A, POINT_B and POINT_C.',
      'Visit them in order A → B → C, then return home. The check records where the tool is each time a block starts, so every checkpoint needs its own move.',
      'Turn on Step mode to watch one move at a time.',
    ],
    concepts: ['Sequencing', 'Move to pose', 'Step mode'],
    blocks: ['home', 'move_pose', 'end'],
    layout: {
      stations: [
        station('table', 'Pedestal A', 460, 280, { w: 120, d: 120, h: 100 }),
        station('table', 'Pedestal B', 0, 560, { w: 120, d: 120, h: 250 }),
        station('table', 'Pedestal C', -460, 280, { w: 120, d: 120, h: 160 }),
      ],
    },
    extraPoses: [
      { name: 'POINT_A', x: 460, y: 160, z: 280 },
      { name: 'POINT_B', x: 0, y: 310, z: 560 },
      { name: 'POINT_C', x: -460, y: 220, z: 280 },
    ],
    scene: { ...DEFAULT_SCENE, colors: [], defectRate: 0, maxParts: 0 },
    starter: [],
    objectives: [
      { id: 'tour', label: 'Visit POINT_A, POINT_B and POINT_C in that order', check: { type: 'visit', poses: ['POINT_A', 'POINT_B', 'POINT_C'] } },
      { id: 'home', label: 'The robot ends at home', check: { type: 'home' } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Use one Move to pose block per checkpoint.',
      'Start → Go home → Move to pose POINT_A → POINT_B → POINT_C → Go home → End.',
    ],
    solution: [
      b('home'),
      b('move_pose', { pose: 'POINT_A' }),
      b('move_pose', { pose: 'POINT_B' }),
      b('move_pose', { pose: 'POINT_C' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'conveyor-unload',
    level: 'easy',
    title: 'Unload the conveyor',
    summary: 'Wait for three parts to arrive on the belt and drop each one in the tote.',
    brief: [
      'Start the conveyor. Parts ride to the end stop, where a photo-eye switches input DI0 on.',
      'Wait for DI0 before every pick, otherwise the gripper closes on thin air. Put all three parts in the tote (pose BIN_TOTE) and stop the belt when you are done.',
      'You can copy the wait → pick → place blocks three times, or try a Repeat loop.',
    ],
    concepts: ['Sensors', 'Wait for input', 'Conveyor control'],
    blocks: ['conveyor', 'wait_input', 'pick', 'place', 'for'],
    layout: {
      stations: [
        station('conveyor', 'Infeed conveyor', -395, 500, { pose: 'PICK' }),
        station('bin', 'Tote', 420, 300, { pose: 'BIN_TOTE', color: BLUE, size: 200 }),
        station('beacon', 'Stack light', -640, 330),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['yellow'], defectRate: 0, maxParts: 3 },
    starter: [],
    objectives: [
      { id: 'tote', label: 'Three parts are in the tote', check: { type: 'bin', pose: 'BIN_TOTE', count: 3 } },
      { id: 'belt', label: 'The conveyor is stopped at the end (DO0 off)', check: { type: 'output', channel: 0, value: false } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Conveyor (start) first, then Wait for input: DI0 on.',
      'A Repeat block with count 3 runs its loop output three times, then continues from done.',
      'Repeat 3 × [Wait for input DI0 → Pick PICK → Place BIN_TOTE], then Conveyor (stop).',
    ],
    solution: [
      b('home'),
      b('conveyor', { action: 'start', speed: 180 }),
      {
        repeat: 3,
        var: 'i',
        body: [b('wait_input', { channel: '0', value: 'on', timeout: 20 }), b('pick', { pose: 'PICK' }), b('place', { pose: 'BIN_TOTE' })],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'tray-sorter',
    level: 'intermediate',
    title: 'Tray colour sorter',
    summary: 'Empty a 2 × 3 tray and sort the parts into red, green and yellow bins.',
    brief: [
      'The tray holds six parts in two rows of three, 70 mm apart. TRAY is the first slot; the others are offsets from it.',
      'Use a Repeat loop with a counter. Slot i sits at ΔX = (i % 3) * 70 and ΔZ = floor(i / 3) * 70 from TRAY.',
      'After the pick, Vision inspect uses the wrist camera to read part_color. Send each part to the bin of its colour.',
    ],
    concepts: ['Loops', 'Offsets from a pose', 'Wrist camera', 'If / else'],
    blocks: ['for', 'pick', 'inspect', 'if', 'place'],
    layout: {
      stations: [
        station('tray', 'Tray', 440, 200, { pose: 'TRAY', rows: 2, cols: 3 }),
        station('bin', 'Red', -300, -440, { pose: 'BIN_RED', color: RED }),
        station('bin', 'Green', -500, -120, { pose: 'BIN_GREEN', color: GREEN }),
        station('bin', 'Yellow', -470, 210, { pose: 'BIN_YELLOW', color: YELLOW }),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['red', 'green', 'yellow'], defectRate: 0, maxParts: 0 },
    starter: [],
    objectives: [
      { id: 'red', label: 'The red bin holds only red parts', check: { type: 'bin_sorted', pose: 'BIN_RED', accept: 'red' } },
      { id: 'green', label: 'The green bin holds only green parts', check: { type: 'bin_sorted', pose: 'BIN_GREEN', accept: 'green' } },
      { id: 'yellow', label: 'The yellow bin holds only yellow parts', check: { type: 'bin_sorted', pose: 'BIN_YELLOW', accept: 'yellow' } },
      { id: 'all', label: 'All six parts are sorted', check: { type: 'parts_in_bins', count: 6 } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Repeat 6 times with the counter i. Inside: Pick → Vision inspect → decide → Place.',
      'Pick at TRAY with ΔX = (i % 3) * 70 and ΔZ = floor(i / 3) * 70.',
      'Two If blocks: part_color == "red" → BIN_RED; otherwise part_color == "green" → BIN_GREEN; otherwise BIN_YELLOW.',
    ],
    solution: [
      b('home'),
      {
        repeat: 6,
        var: 'i',
        body: [
          b('pick', { pose: 'TRAY', dx: '(i % 3) * 70', dz: 'floor(i / 3) * 70', approach: 150 }),
          b('inspect', { camera: 'wrist' }),
          {
            if: 'part_color == "red"',
            then: [b('place', { pose: 'BIN_RED', approach: 150 })],
            else: [
              {
                if: 'part_color == "green"',
                then: [b('place', { pose: 'BIN_GREEN', approach: 150 })],
                else: [b('place', { pose: 'BIN_YELLOW', approach: 150 })],
              },
            ],
          },
        ],
      },
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'tower-builder',
    level: 'intermediate',
    title: 'Tower builder',
    summary: 'Stack five conveyor parts into a single tower on the table.',
    brief: [
      'Take five parts off the conveyor and stack them on the table (pose TABLE) into one straight tower.',
      'Each part is 50 mm tall. Keep the current tower height in a variable and use it as the ΔY offset of the Place block, then raise it by 50 after every part.',
      'A tower that leans topples: every part must land right on top of the one below.',
    ],
    concepts: ['Variables', 'Change variable', 'Offsets'],
    blocks: ['set_var', 'for', 'wait_input', 'pick', 'place', 'change_var'],
    layout: {
      stations: [
        station('conveyor', 'Infeed conveyor', -395, 500, { pose: 'PICK' }),
        station('table', 'Build table', 420, 250, { pose: 'TABLE', w: 300, d: 300, h: 150 }),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['red', 'green', 'blue', 'yellow'], defectRate: 0, maxParts: 5 },
    starter: [],
    objectives: [
      { id: 'tower', label: 'Five parts stand in one tower on TABLE', check: { type: 'stack', pose: 'TABLE', count: 5 } },
      { id: 'belt', label: 'The conveyor is stopped at the end (DO0 off)', check: { type: 'output', channel: 0, value: false } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Set variable height = 0 before the loop.',
      'Place at TABLE with ΔY = height, then Change variable height by 50.',
      'Give the Place block a bigger approach (150 mm) so the held part clears the tower on the way in.',
    ],
    solution: [
      b('home'),
      b('conveyor', { action: 'start', speed: 200 }),
      b('set_var', { var: 'height', value: '0' }),
      {
        repeat: 5,
        var: 'i',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('pick', { pose: 'PICK' }),
          b('place', { pose: 'TABLE', dy: 'height', approach: 150 }),
          b('change_var', { var: 'height', by: 50 }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'machine-tending',
    level: 'intermediate',
    title: 'Tend the CNC',
    summary: 'Machine two raw parts and drop the finished ones in the output bin.',
    brief: [
      'Two raw parts wait on the tray. Each one must be loaded into the CNC machine (pose MACHINE), machined, and unloaded into the Finished bin.',
      'The machine only starts when the robot is out of its zone: wait for DI2 (zone clear), then pulse DO1 (on, then off) to start the cycle. DI1 turns on when the part is done.',
      'Entering the machine zone while it runs trips the safety interlock and faults the program.',
    ],
    concepts: ['I/O handshake', 'Safety interlock', 'Timeouts'],
    blocks: ['for', 'pick', 'place', 'home', 'wait_input', 'set_output'],
    layout: {
      stations: [
        station('tray', 'Raw parts', 430, 220, { pose: 'TRAY', rows: 1, cols: 2 }),
        station('machine', 'CNC machine', -480, -220, { pose: 'MACHINE', cycle: 3 }),
        station('bin', 'Finished', 300, -430, { pose: 'BIN_FINISHED', color: GREY }),
        station('beacon', 'Stack light', -640, 330),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['yellow'], defectRate: 0, maxParts: 0 },
    starter: [],
    objectives: [
      { id: 'done', label: 'Two machined parts are in the Finished bin', check: { type: 'bin', pose: 'BIN_FINISHED', count: 2, machined: true } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Repeat 2 times with counter job. Pick at TRAY with ΔX = job * 70.',
      'After Place at MACHINE, Go home so the robot leaves the zone, then Wait for input DI2 on.',
      'Set output DO1 on → Set output DO1 off → Wait for input DI1 on → Pick MACHINE → Place BIN_FINISHED.',
    ],
    solution: [
      b('home'),
      {
        repeat: 2,
        var: 'job',
        body: [
          b('pick', { pose: 'TRAY', dx: 'job * 70' }),
          b('place', { pose: 'MACHINE', approach: 150 }),
          b('home'),
          b('wait_input', { channel: '2', value: 'on', timeout: 5 }),
          b('set_output', { channel: '1', value: 'on' }),
          b('set_output', { channel: '1', value: 'off' }),
          b('wait_input', { channel: '1', value: 'on', timeout: 10 }),
          b('pick', { pose: 'MACHINE', approach: 150 }),
          b('place', { pose: 'BIN_FINISHED' }),
        ],
      },
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'quality-gate',
    level: 'hard',
    title: 'Quality gate',
    summary: 'Inspect ten parts: sort good ones by colour, reject defects, and report every part over MQTT.',
    brief: [
      'Parts arrive in three colours, and about a third of them carry a defect mark. Handle exactly ten parts.',
      'Inspect each part at the pick point. Defective parts go to BIN_REJECT; good parts go to the bin of their colour.',
      'After every part, publish a message to the topic factory/quality so the line dashboard stays up to date. Stop the belt when the batch is done.',
    ],
    concepts: ['Vision', 'Nested decisions', 'Counters', 'MQTT telemetry'],
    blocks: ['conveyor', 'for', 'wait_input', 'inspect', 'pick', 'if', 'place', 'mqtt_publish'],
    layout: {
      stations: [
        station('conveyor', 'Infeed conveyor', -395, 500, { pose: 'PICK' }),
        station('bin', 'Red', -330, -480, { pose: 'BIN_RED', color: RED }),
        station('bin', 'Green', -110, -480, { pose: 'BIN_GREEN', color: GREEN }),
        station('bin', 'Blue', 110, -480, { pose: 'BIN_BLUE', color: BLUE }),
        station('bin', 'Reject', 330, -480, { pose: 'BIN_REJECT', color: GREY }),
        station('beacon', 'Stack light', -640, 330),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['red', 'green', 'blue'], defectRate: 0.3, maxParts: 0 },
    starter: [],
    objectives: [
      { id: 'red', label: 'The red bin holds only good red parts', check: { type: 'bin_sorted', pose: 'BIN_RED', accept: 'red' } },
      { id: 'green', label: 'The green bin holds only good green parts', check: { type: 'bin_sorted', pose: 'BIN_GREEN', accept: 'green' } },
      { id: 'blue', label: 'The blue bin holds only good blue parts', check: { type: 'bin_sorted', pose: 'BIN_BLUE', accept: 'blue' } },
      { id: 'reject', label: 'The reject bin holds only defective parts', check: { type: 'bin_sorted', pose: 'BIN_REJECT', accept: 'defect' } },
      { id: 'count', label: 'Exactly ten parts are in the bins', check: { type: 'parts_in_bins', count: 10 } },
      { id: 'mqtt', label: 'Ten messages published to factory/quality', check: { type: 'telemetry', topic: 'factory/quality', count: 10 } },
      { id: 'belt', label: 'The conveyor is stopped at the end (DO0 off)', check: { type: 'output', channel: 0, value: false } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Repeat 10 × [Wait for input DI0 → Vision inspect → Pick PICK → decide → Place → MQTT publish].',
      'Check part_defect first. Only good parts go on to the colour checks.',
      'The payload can include variables, for example {"part": {n}, "color": "{part_color}", "defect": {part_defect}}.',
    ],
    solution: [
      b('home'),
      b('conveyor', { action: 'start', speed: 200 }),
      {
        repeat: 10,
        var: 'n',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('inspect'),
          b('pick', { pose: 'PICK', speed: 80 }),
          {
            if: 'part_defect',
            then: [b('place', { pose: 'BIN_REJECT', speed: 80 })],
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
            ],
          },
          b('mqtt_publish', { topic: 'factory/quality', payload: '{"part": {n}, "color": "{part_color}", "defect": {part_defect}}' }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'pallet-pattern',
    level: 'hard',
    title: 'Two-layer pallet',
    summary: 'Build a 2 × 2 × 2 pallet from the conveyor and signal that it is ready.',
    brief: [
      'Build a pallet of eight parts: two layers, each a 2 × 2 square with a 70 mm pitch. PALLET is the first corner slot.',
      'The Pallet slot block turns a slot number into the offsets pallet_dx, pallet_dy and pallet_dz. Use them on the Place block.',
      'When the pallet is complete, stop the belt and switch the green stack light on (DO2) so the forklift driver knows it is ready.',
    ],
    concepts: ['Computed patterns', 'Frame + offset programming', 'Status lights'],
    blocks: ['conveyor', 'for', 'wait_input', 'pick', 'pallet', 'place', 'set_output'],
    layout: {
      stations: [
        station('conveyor', 'Infeed conveyor', -395, 500, { pose: 'PICK' }),
        station('pallet', 'Pallet', 470, 160, { pose: 'PALLET' }),
        station('fence', 'Guard', -700, -200, { rot: 90, length: 900 }),
        station('beacon', 'Stack light', -640, 330),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['yellow'], defectRate: 0, maxParts: 8 },
    starter: [],
    objectives: [
      { id: 'pallet', label: 'Eight parts are on the pallet', check: { type: 'pallet', count: 8 } },
      { id: 'layers', label: 'The pallet has two full layers of four', check: { type: 'pallet', count: 8, layers: 2 } },
      { id: 'light', label: 'The green light is on at the end (DO2)', check: { type: 'output', channel: 2, value: true } },
      { id: 'belt', label: 'The conveyor is stopped at the end (DO0 off)', check: { type: 'output', channel: 0, value: false } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Repeat 8 times with the counter slot.',
      'Pallet slot: index slot, 2 columns, 2 rows, pitch 70, layer height 50.',
      'Place at PALLET with ΔX = pallet_dx, ΔY = pallet_dy, ΔZ = pallet_dz and an approach of 150 mm.',
    ],
    solution: [
      b('home'),
      b('conveyor', { action: 'start', speed: 220 }),
      {
        repeat: 8,
        var: 'slot',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('pick', { pose: 'PICK', speed: 80 }),
          b('pallet', { index: 'slot', cols: 2, rows: 2, pitch_x: 70, pitch_z: 70, layer_height: 50 }),
          b('place', { pose: 'PALLET', dx: 'pallet_dx', dy: 'pallet_dy', dz: 'pallet_dz', approach: 150, speed: 80 }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('set_output', { channel: '2', value: 'on' }),
      b('home'),
      b('end'),
    ],
  },
  {
    id: 'two-lane-rush',
    level: 'hard',
    title: 'Two-lane rush',
    summary: 'Serve two conveyors at once and sort twelve parts by colour against the clock.',
    brief: [
      'Two conveyors feed the cell from opposite sides. Input DI0 turns on when a part waits at either end stop, but it does not say which one.',
      'Each conveyor has its own camera, named after it. Inspect "Infeed A" to see whether a part waits there; if it reads "none", the part is on Infeed B. Pick from PICK or PICK_B accordingly.',
      'Sort twelve parts into the red, green and blue bins in under 100 simulated seconds. The clock is simulation time, so the speed setting does not matter.',
    ],
    concepts: ['Named cameras', 'While loops', 'Choosing between stations', 'Cycle time'],
    blocks: ['conveyor', 'set_var', 'while', 'wait_input', 'inspect', 'if', 'pick', 'place', 'change_var'],
    layout: {
      stations: [
        station('conveyor', 'Infeed A', -420, 470, { pose: 'PICK', length: 700 }),
        station('conveyor', 'Infeed B', 420, 470, { pose: 'PICK_B', length: 700, rot: 180, camSide: -1 }),
        station('bin', 'Red', -420, -380, { pose: 'BIN_RED', color: RED }),
        station('bin', 'Green', -150, -540, { pose: 'BIN_GREEN', color: GREEN }),
        station('bin', 'Blue', 420, -380, { pose: 'BIN_BLUE', color: BLUE }),
        station('beacon', 'Stack light', 0, 960),
      ],
    },
    scene: { ...DEFAULT_SCENE, colors: ['red', 'green', 'blue'], defectRate: 0, maxParts: 12 },
    starter: [],
    objectives: [
      { id: 'red', label: 'The red bin holds only red parts', check: { type: 'bin_sorted', pose: 'BIN_RED', accept: 'red' } },
      { id: 'green', label: 'The green bin holds only green parts', check: { type: 'bin_sorted', pose: 'BIN_GREEN', accept: 'green' } },
      { id: 'blue', label: 'The blue bin holds only blue parts', check: { type: 'bin_sorted', pose: 'BIN_BLUE', accept: 'blue' } },
      { id: 'all', label: 'All twelve parts are sorted', check: { type: 'parts_in_bins', count: 12 } },
      { id: 'time', label: 'Done in under 100 s of simulated time', check: { type: 'time', seconds: 100 } },
      { id: 'finished', label: 'The program finishes without a fault', check: { type: 'finished' } },
    ],
    hints: [
      'Keep a counter: Set variable sorted = 0, then While sorted < 12.',
      'Vision inspect with camera "Infeed A". If part_color != "none", pick at PICK; otherwise inspect "Infeed B" and pick at PICK_B.',
      'After the pick, part_color still holds the colour from the last inspection: use it to choose the bin, then Change variable sorted by 1.',
    ],
    solution: [
      b('home'),
      b('conveyor', { action: 'start', speed: 220 }),
      b('set_var', { var: 'sorted', value: '0' }),
      {
        while: 'sorted < 12',
        body: [
          b('wait_input', { channel: '0', value: 'on', timeout: 20 }),
          b('inspect', { camera: 'Infeed A' }),
          {
            if: 'part_color != "none"',
            then: [b('pick', { pose: 'PICK', speed: 90 })],
            else: [b('inspect', { camera: 'Infeed B' }), b('pick', { pose: 'PICK_B', speed: 90 })],
          },
          {
            if: 'part_color == "red"',
            then: [b('place', { pose: 'BIN_RED', speed: 90 })],
            else: [
              {
                if: 'part_color == "green"',
                then: [b('place', { pose: 'BIN_GREEN', speed: 90 })],
                else: [b('place', { pose: 'BIN_BLUE', speed: 90 })],
              },
            ],
          },
          b('change_var', { var: 'sorted', by: 1 }),
        ],
      },
      b('conveyor', { action: 'stop' }),
      b('home'),
      b('end'),
    ],
  },
];

export const MISSION_BY_ID: Record<string, Mission> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

export function missionPoses(mission: Mission): Pose[] {
  return [...posesForLayout(mission.layout), ...(mission.extraPoses ?? [])];
}

const VISIT_TOLERANCE = 25;
const STACK_TOLERANCE = 15;
const HOME_TOLERANCE = 5;

export class VisitRecorder {
  visits: string[] = [];
  private targets: Pose[];

  constructor(mission: Mission | null, poses: Pose[]) {
    const names = new Set(mission?.objectives.flatMap((o) => (o.check.type === 'visit' ? o.check.poses : [])) ?? []);
    this.targets = poses.filter((p) => names.has(p.name));
  }

  sample(world: World) {
    if (!this.targets.length) return;
    const tcp = world.tcp;
    const hit = this.targets.find((p) => Math.hypot(p.x - tcp.x, p.y - tcp.y, p.z - tcp.z) <= VISIT_TOLERANCE);
    if (hit && this.visits[this.visits.length - 1] !== hit.name) this.visits.push(hit.name);
  }
}

function restingParts(world: World): Part[] {
  return world.parts.filter((p) => p !== world.held && !p.fall && !p.belt);
}

function partsInBin(world: World, pose: string): Part[] | null {
  const bin = world.layout.stations.find((s) => s.kind === 'bin' && s.pose === pose);
  if (!bin) return null;
  return restingParts(world).filter((p) => {
    const l = toLocal(bin, p.pos.x, p.pos.z);
    return inBox(footprint(bin), l.x, l.z);
  });
}

function palletParts(world: World): Part[] {
  const pallets = world.layout.stations.filter((s) => s.kind === 'pallet');
  return restingParts(world).filter((p) =>
    pallets.some((s) => {
      const l = toLocal(s, p.pos.x, p.pos.z);
      return inBox(footprint(s), l.x, l.z);
    }),
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function evaluateCheck(check: MissionCheck, world: World, poses: Pose[], run: MissionRun): { passed: boolean; detail: string } {
  switch (check.type) {
    case 'finished': {
      const { status, message } = run.result;
      if (status === 'done') return { passed: true, detail: 'The program reached its end.' };
      if (status === 'fault') return { passed: false, detail: message ?? 'The program faulted.' };
      return { passed: false, detail: 'The program was stopped before it finished.' };
    }
    case 'bin': {
      const parts = partsInBin(world, check.pose);
      if (!parts) return { passed: false, detail: `There is no bin with pose ${check.pose}.` };
      const matching = parts.filter((p) => (!check.color || p.color === check.color) && (!check.machined || p.machined));
      const what = check.machined ? 'machined part' : 'part';
      const extra = check.machined && parts.length > matching.length ? `, ${plural(parts.length - matching.length, 'unmachined part')}` : '';
      return { passed: matching.length === check.count && parts.length === check.count, detail: `${plural(matching.length, what)} in ${check.pose}${extra}; expected ${check.count}.` };
    }
    case 'bin_sorted': {
      const parts = partsInBin(world, check.pose);
      if (!parts) return { passed: false, detail: `There is no bin with pose ${check.pose}.` };
      const wrong = parts.filter((p) => (check.accept === 'defect' ? !p.defect : p.defect || p.color !== check.accept));
      if (!parts.length) return { passed: false, detail: `${check.pose} is empty.` };
      if (!wrong.length) return { passed: true, detail: `${plural(parts.length, 'part')} in ${check.pose}, all correct.` };
      const describe = (p: Part) => `${p.defect ? 'defective ' : ''}${p.color}`;
      return { passed: false, detail: `${plural(wrong.length, 'wrong part')} in ${check.pose}: ${wrong.map(describe).join(', ')}.` };
    }
    case 'parts_in_bins': {
      const bins = world.layout.stations.filter((s) => s.kind === 'bin' && s.pose);
      const total = bins.reduce((n, s) => n + (partsInBin(world, s.pose!)?.length ?? 0), 0);
      return { passed: total === check.count, detail: `${plural(total, 'part')} in the bins; expected ${check.count}.` };
    }
    case 'pallet': {
      const parts = palletParts(world);
      if (!check.layers) return { passed: parts.length === check.count, detail: `${plural(parts.length, 'part')} on the pallet; expected ${check.count}.` };
      const perLayer = check.count / check.layers;
      const layers = Array.from({ length: check.layers }, (_, i) => {
        const y = PALLET_TOP + PART_SIZE / 2 + i * PART_SIZE;
        return parts.filter((p) => Math.abs(p.pos.y - y) < PART_SIZE / 4).length;
      });
      return { passed: layers.every((n) => n === perLayer), detail: `Layers hold ${layers.join(' and ')} parts; expected ${perLayer} each.` };
    }
    case 'stack': {
      const pose = poses.find((p) => p.name === check.pose);
      if (!pose) return { passed: false, detail: `Pose ${check.pose} is missing.` };
      const column = restingParts(world).filter((p) => Math.hypot(p.pos.x - pose.x, p.pos.z - pose.z) <= STACK_TOLERANCE && p.pos.y >= pose.y - PART_SIZE / 4);
      return { passed: column.length === check.count, detail: `${plural(column.length, 'part')} in the tower at ${check.pose}; expected ${check.count}.` };
    }
    case 'visit': {
      let next = 0;
      for (const name of run.visits) if (name === check.poses[next]) next++;
      const passed = next >= check.poses.length;
      const seen = run.visits.length ? run.visits.join(' → ') : 'none';
      return { passed, detail: passed ? `Visited ${check.poses.join(' → ')}.` : `Checkpoints reached: ${seen}. Next expected: ${check.poses[next]}.` };
    }
    case 'home': {
      const home = forwardKinematics(HOME_JOINTS);
      const tcp = world.tcp;
      const d = Math.hypot(home.x - tcp.x, home.y - tcp.y, home.z - tcp.z);
      return { passed: d <= HOME_TOLERANCE, detail: d <= HOME_TOLERANCE ? 'The robot is at home.' : `The tool is ${Math.round(d)} mm away from home.` };
    }
    case 'output': {
      const on = world.outputs[check.channel];
      const state = (v: boolean) => (v ? 'on' : 'off');
      return { passed: on === check.value, detail: `DO${check.channel} is ${state(on)}; expected ${state(check.value)}.` };
    }
    case 'telemetry': {
      const n = run.telemetry.filter((t) => t.topic === check.topic).length;
      return { passed: n >= check.count, detail: `${plural(n, 'message')} on ${check.topic}; expected ${check.count}.` };
    }
    case 'time': {
      const t = Math.round(run.time * 10) / 10;
      return { passed: run.time <= check.seconds, detail: `Took ${t} s; the limit is ${check.seconds} s.` };
    }
  }
}

export function gradeMission(mission: Mission, world: World, poses: Pose[], run: MissionRun): ObjectiveResult[] {
  const finished = run.result.status === 'done';
  return mission.objectives.map((o) => {
    const r = evaluateCheck(o.check, world, poses, run);
    const passed = r.passed && (finished || o.check.type === 'finished');
    return { id: o.id, label: o.label, passed, detail: r.passed && !passed ? `${r.detail} Only counts when the program finishes.` : r.detail };
  });
}

const PROGRESS_KEY = 'cubot-blocks-missions';

export type MissionStatus = 'new' | 'started' | 'passed';

export function loadMissionProgress(): Record<string, MissionStatus> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function saveMissionStatus(id: string, status: MissionStatus): Record<string, MissionStatus> {
  const progress = loadMissionProgress();
  if (progress[id] === 'passed') return progress;
  const next = { ...progress, [id]: status };
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}
