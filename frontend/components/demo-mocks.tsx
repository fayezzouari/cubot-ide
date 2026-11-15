import type { ReactNode } from 'react';

const W = 1600;
const H = 900;
const BAR = 48;

function T({
  x,
  y,
  children,
  className = 'fill-ink-2',
  size = 14,
  mono = false,
  anchor,
  weight,
}: {
  x: number;
  y: number;
  children: ReactNode;
  className?: string;
  size?: number;
  mono?: boolean;
  anchor?: 'middle' | 'end';
  weight?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      className={`${mono ? 'font-mono' : 'font-sans'} ${className}`}
      style={{ whiteSpace: 'pre' }}
    >
      {children}
    </text>
  );
}

function Shell({ project, workspace, action, children }: { project: string; workspace: string; action: string; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMin slice" role="img" aria-label={`${workspace} preview`}>
      <rect width={W} height={H} className="fill-page" />
      <rect width={W} height={BAR} className="fill-well" />
      <line x1="0" y1={BAR} x2={W} y2={BAR} className="stroke-line" />
      <rect x="20" y="14" width="20" height="20" rx="5" fill="none" className="stroke-ink" strokeWidth="1.5" />
      <T x={52} y={30} className="fill-ink" size={15} weight={600}>CuBot</T>
      <T x={112} y={30} className="fill-ink-3">/</T>
      <T x={128} y={30} className="fill-ink-2">{project}</T>
      <rect x={W - 250} y="10" width="104" height="28" rx="6" fill="none" className="stroke-line-strong" />
      <T x={W - 198} y={29} anchor="middle" className="fill-ink" size={13}>{workspace}</T>
      <rect x={W - 134} y="10" width="84" height="28" rx="6" className="fill-ink" />
      <T x={W - 92} y={29} anchor="middle" className="fill-page" size={13} weight={600}>{action}</T>
      <circle cx={W - 26} cy="24" r="12" className="fill-raised stroke-line-strong" />
      {children}
    </svg>
  );
}

const CODE = [
  '#include <Arduino.h>',
  '',
  'const int LEFT_IR = A0;',
  'const int RIGHT_IR = A1;',
  'const int LEFT_PWM = 5;',
  'const int RIGHT_PWM = 6;',
  '',
  'void setup() {',
  '  pinMode(LEFT_PWM, OUTPUT);',
  '  pinMode(RIGHT_PWM, OUTPUT);',
  '}',
  '',
  'void loop() {',
  '  bool left = analogRead(LEFT_IR) > 512;',
  '  bool right = analogRead(RIGHT_IR) > 512;',
  '  analogWrite(LEFT_PWM, right ? 180 : 90);',
  '  analogWrite(RIGHT_PWM, left ? 180 : 90);',
  '}',
];

const TOKEN = /(#include|\b(?:const|int|void|bool)\b|\b\d+\b)/;

function tokenClass(token: string) {
  if (/^\d+$/.test(token)) return 'fill-ws-blocks';
  if (TOKEN.test(token)) return 'fill-ws-ide';
  return 'fill-ink-2';
}

function IdeMock() {
  const files = ['src', 'main.cpp', 'sensors.h', 'motors.h', 'platformio.ini', 'README.md'];
  const steps = ['Reading main.cpp', 'Editing main.cpp  +24 −3', 'Compiling project', 'Build passed'];
  return (
    <Shell project="line-follower" workspace="Code IDE" action="Upload">
      <rect x="0" y={BAR} width="250" height={H - BAR} className="fill-surface" />
      <line x1="250" y1={BAR} x2="250" y2={H} className="stroke-line" />
      <T x={20} y={84} className="fill-ink-3" size={13}>Explorer</T>
      {files.map((name, i) => (
        <g key={name}>
          {name === 'main.cpp' && <rect x="8" y={102 + i * 32} width="234" height="28" rx="6" className="fill-raised" />}
          <T x={i === 0 ? 20 : 40} y={121 + i * 32} className={name === 'main.cpp' ? 'fill-ink' : 'fill-ink-2'}>{name}</T>
        </g>
      ))}

      <rect x="250" y={BAR} width="890" height="40" className="fill-surface" />
      <rect x="250" y={BAR} width="130" height="40" className="fill-page" />
      <T x={272} y={BAR + 25} className="fill-ink">main.cpp</T>
      <T x={402} y={BAR + 25} className="fill-ink-3">sensors.h</T>
      <line x1="250" y1={BAR + 40} x2="1140" y2={BAR + 40} className="stroke-line" />
      {CODE.map((line, i) => (
        <g key={i}>
          <T x={292} y={122 + i * 28} anchor="end" className="fill-ink-3" mono size={14}>{i + 1}</T>
          <T x={316} y={122 + i * 28} mono size={14}>
            {line.split(TOKEN).map((token, j) => (
              <tspan key={j} className={tokenClass(token)}>{token}</tspan>
            ))}
          </T>
        </g>
      ))}

      <rect x="250" y="650" width="890" height="250" className="fill-well" />
      <line x1="250" y1="650" x2="1140" y2="650" className="stroke-line" />
      <T x={272} y={678} className="fill-ink" size={13}>Build output</T>
      <T x={372} y={678} className="fill-ink-3" size={13}>Serial monitor</T>
      {['Compiling src/main.cpp', 'Linking firmware.elf', 'RAM    9.2%  (189 of 2048 bytes)', 'Flash  6.1%  (1968 of 32256 bytes)'].map((line, i) => (
        <T key={line} x={272} y={716 + i * 26} mono size={13} className="fill-ink-3">{line}</T>
      ))}
      <T x={272} y={820} mono size={13} className="fill-ok">Build passed in 4.2 s</T>

      <rect x="1140" y={BAR} width="460" height={H - BAR} className="fill-surface" />
      <line x1="1140" y1={BAR} x2="1140" y2={H} className="stroke-line" />
      <T x={1164} y={84} className="fill-ink" weight={600}>Assistant</T>
      <rect x="1220" y="108" width="356" height="62" rx="10" className="fill-raised" />
      <T x={1238} y={134} className="fill-ink" size={13}>Follow a black line with two IR</T>
      <T x={1238} y={154} className="fill-ink" size={13}>sensors on A0 and A1.</T>
      {steps.map((step, i) => (
        <g key={step}>
          <circle cx="1172" cy={211 + i * 34} r="4" className={i === 3 ? 'fill-ok' : 'fill-ink-3'} />
          <T x={1190} y={216 + i * 34} size={13} className={i === 3 ? 'fill-ok' : 'fill-ink-2'}>{step}</T>
        </g>
      ))}
      <T x={1164} y={372} size={13} className="fill-ink-2">The robot now steers toward the sensor that</T>
      <T x={1164} y={392} size={13} className="fill-ink-2">sees the line. Both motors use PWM on pins</T>
      <T x={1164} y={412} size={13} className="fill-ink-2">5 and 6.</T>
      <rect x="1164" y="440" width="412" height="52" rx="10" fill="none" className="stroke-line" />
      <T x={1182} y={471} mono size={13} className="fill-ink">main.cpp</T>
      <T x={1556} y={471} anchor="end" size={13} className="fill-ink-3">Revert</T>
      <rect x="1164" y={H - 76} width="412" height="48" rx="10" fill="none" className="stroke-line-strong" />
      <T x={1182} y={H - 46} size={13} className="fill-ink-3">Ask for a change</T>
    </Shell>
  );
}

function BlocksMock() {
  const groups = [
    ['Motion', 'fill-ws-blocks'],
    ['Loops', 'fill-ws-ide'],
    ['Logic', 'fill-ws-fleet'],
    ['Sensors', 'fill-ws-cad'],
    ['Timing', 'fill-ink-3'],
  ];
  const blocks = ['move joint 2 to 42°', 'close gripper', 'wait 0.5 s', 'move joint 1 to −30°', 'open gripper'];
  const j1 = { x: 1270, y: 610 };
  const j2 = { x: 1360, y: 400 };
  const j3 = { x: 1500, y: 440 };
  const j4 = { x: 1530, y: 540 };
  return (
    <Shell project="pick-and-place" workspace="Block Builder" action="Run">
      <rect x="0" y={BAR} width="230" height={H - BAR} className="fill-surface" />
      <line x1="230" y1={BAR} x2="230" y2={H} className="stroke-line" />
      <T x={20} y={84} className="fill-ink-3" size={13}>Blocks</T>
      {groups.map(([name, dot], i) => (
        <g key={name}>
          {i === 0 && <rect x="8" y="102" width="214" height="30" rx="6" className="fill-raised" />}
          <circle cx="28" cy={117 + i * 36} r="5" className={dot} />
          <T x={46} y={122 + i * 36} className={i === 0 ? 'fill-ink' : 'fill-ink-2'}>{name}</T>
        </g>
      ))}

      <rect x="300" y="120" width="560" height="420" rx="12" fill="none" className="stroke-ws-ide" strokeOpacity="0.5" />
      <rect x="300" y="120" width="560" height="52" rx="12" className="fill-ws-ide" fillOpacity="0.14" />
      <T x={324} y={152} className="fill-ws-ide" size={15} weight={600}>repeat 3 times</T>
      {blocks.map((label, i) => (
        <g key={label}>
          {i === 2 && <rect x="326" y={190 + i * 66} width="500" height="52" rx="10" fill="none" className="stroke-ink" strokeWidth="1.5" />}
          <rect x="330" y={194 + i * 66} width="492" height="44" rx="8" className="fill-ws-blocks" fillOpacity={i === 2 ? 0.26 : 0.14} />
          <rect x="330" y={194 + i * 66} width="492" height="44" rx="8" fill="none" className="stroke-ws-blocks" strokeOpacity="0.45" />
          <T x={352} y={222 + i * 66} className="fill-ink" size={15}>{label}</T>
        </g>
      ))}
      <rect x="300" y="574" width="250" height="48" rx="10" className="fill-ws-cad" fillOpacity="0.14" />
      <rect x="300" y="574" width="250" height="48" rx="10" fill="none" className="stroke-ws-cad" strokeOpacity="0.45" />
      <T x={322} y={604} className="fill-ink" size={15}>return to home</T>

      <rect x="1000" y={BAR} width="600" height={H - BAR} className="fill-well" />
      <line x1="1000" y1={BAR} x2="1000" y2={H} className="stroke-line" />
      <T x={1024} y={84} className="fill-ink" weight={600}>Arm preview</T>
      <T x={1576} y={84} anchor="end" className="fill-ink-3" size={13}>Step 3 of 6</T>
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx="1300" cy="700" rx={80 + i * 60} ry={(80 + i * 60) / 2.2} fill="none" className="stroke-line" />
      ))}
      <path d="M1190 690 L1270 650 L1350 690 L1270 730 Z" className="fill-surface stroke-ink-3" />
      <path d="M1190 690 L1190 720 L1270 760 L1350 720 L1350 690 L1270 730 Z" className="fill-page stroke-ink-3" />
      {[[j1, j2, 26], [j2, j3, 18], [j3, j4, 12]].map(([a, b, w], i) => {
        const from = a as { x: number; y: number };
        const to = b as { x: number; y: number };
        return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={w as number} strokeLinecap="round" className={i === 1 ? 'stroke-ws-blocks' : 'stroke-line-strong'} strokeOpacity={i === 1 ? 0.6 : 1} />;
      })}
      {[[j1, 30], [j2, 24], [j3, 18]].map(([j, r], i) => {
        const at = j as { x: number; y: number };
        return (
          <g key={i}>
            <circle cx={at.x} cy={at.y} r={r as number} className={i === 1 ? 'fill-surface stroke-ws-blocks' : 'fill-surface stroke-ink-3'} strokeWidth="1.5" />
            <circle cx={at.x} cy={at.y} r={(r as number) / 2.4} fill="none" className="stroke-ink-3" />
          </g>
        );
      })}
      <path d={`M${j4.x - 22} ${j4.y} h44 v16 h-44 Z M${j4.x - 22} ${j4.y + 16} l5 40 h8 l-3 -40 Z M${j4.x + 22} ${j4.y + 16} l-5 40 h-8 l3 -40 Z`} className="fill-surface stroke-ink-3" />
      <rect x={j4.x - 16} y={j4.y + 62} width="32" height="32" rx="3" className="fill-ws-blocks stroke-ws-blocks" fillOpacity="0.2" />
      <rect x="1024" y={H - 70} width="552" height="40" rx="8" className="fill-surface stroke-line" />
      <rect x="1036" y={H - 54} width="528" height="8" rx="4" className="fill-line" />
      <rect x="1036" y={H - 54} width="264" height="8" rx="4" className="fill-ink-2" />
    </Shell>
  );
}

function CadMock() {
  const plan = [
    ['Base plate', 'done'],
    ['Standoffs × 4', 'done'],
    ['Top plate', 'running'],
    ['Fasteners', 'waiting'],
  ];
  const params = [
    ['Width', '60 mm'],
    ['Depth', '42 mm'],
    ['Thickness', '3 mm'],
    ['Bore', 'Ø 22 mm'],
  ];
  const plate = (y: number, tint: boolean) => (
    <g>
      <path d={`M560 ${y} L800 ${y - 120} L1040 ${y} L800 ${y + 120} Z`} className={tint ? 'fill-ws-cad stroke-ws-cad' : 'fill-surface stroke-ink-3'} fillOpacity={tint ? 0.16 : 1} strokeWidth="1.4" />
      <path d={`M560 ${y} v14 L800 ${y + 134} L1040 ${y + 14} v-14 L800 ${y + 120} Z`} className={tint ? 'fill-ws-cad stroke-ws-cad' : 'fill-page stroke-ink-3'} fillOpacity={tint ? 0.08 : 1} strokeWidth="1.4" />
    </g>
  );
  return (
    <Shell project="motor-mount" workspace="CAD Designer" action="Export">
      <rect x="0" y={BAR} width="380" height={H - BAR} className="fill-surface" />
      <line x1="380" y1={BAR} x2="380" y2={H} className="stroke-line" />
      <T x={24} y={84} className="fill-ink" weight={600}>Assistant</T>
      <rect x="60" y="108" width="296" height="62" rx="10" className="fill-raised" />
      <T x={78} y={134} className="fill-ink" size={13}>A mount for a NEMA 17 motor with</T>
      <T x={78} y={154} className="fill-ink" size={13}>four M3 holes.</T>
      <T x={24} y={214} className="fill-ink-3" size={13}>Plan</T>
      {plan.map(([name, state], i) => (
        <g key={name}>
          <rect x="24" y={232 + i * 56} width="332" height="46" rx="8" fill="none" className={state === 'running' ? 'stroke-ws-cad' : 'stroke-line'} />
          <circle cx="48" cy={255 + i * 56} r="5" className={state === 'done' ? 'fill-ok' : state === 'running' ? 'fill-ws-cad' : 'fill-line-strong'} />
          <T x={66} y={260 + i * 56} className={state === 'waiting' ? 'fill-ink-3' : 'fill-ink'}>{name}</T>
          <T x={338} y={260 + i * 56} anchor="end" size={13} className="fill-ink-3">{state === 'done' ? 'Built' : state === 'running' ? 'Building' : 'Waiting'}</T>
        </g>
      ))}
      <rect x="24" y={H - 76} width="332" height="48" rx="10" fill="none" className="stroke-line-strong" />
      <T x={42} y={H - 46} size={13} className="fill-ink-3">Describe a change</T>

      <rect x="380" y={BAR} width="900" height={H - BAR} className="fill-well" />
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i}>
          <line x1={400 + i * 55} y1="690" x2={840 + i * 55} y2="470" className="stroke-line" strokeOpacity="0.6" />
          <line x1={400 + i * 55} y1="470" x2={840 + i * 55} y2="690" className="stroke-line" strokeOpacity="0.6" />
        </g>
      ))}
      {[[600, 520], [1000, 520], [800, 620], [800, 420]].map(([x, y], i) => (
        <line key={i} x1={x} y1={y + 150} x2={x} y2={y - 190} className="stroke-line-strong" strokeDasharray="3 6" />
      ))}
      {plate(680, false)}
      {[[610, 560], [990, 560], [800, 650]].map(([x, y], i) => (
        <path key={i} d={`M${x - 16} ${y} l16 -8 l16 8 v52 l-16 8 l-16 -8 Z M${x - 16} ${y} l16 8 l16 -8 M${x} ${y + 8} v52`} className="fill-surface stroke-ink-3" />
      ))}
      {plate(430, true)}
      <ellipse cx="800" cy="430" rx="92" ry="46" className="fill-well stroke-ws-cad" strokeWidth="1.4" />
      <path d="M708 250 v-96 a92 46 0 0 1 184 0 v96 a92 46 0 0 1 -184 0 Z" className="fill-surface stroke-ink-3" strokeWidth="1.4" />
      <ellipse cx="800" cy="154" rx="92" ry="46" className="fill-raised stroke-ink-3" strokeWidth="1.4" />
      <ellipse cx="800" cy="154" rx="18" ry="9" className="fill-well stroke-ink-3" />
      <rect x="1196" y="72" width="60" height="60" rx="8" fill="none" className="stroke-line-strong" />
      <T x={1226} y={108} anchor="middle" size={12} className="fill-ink-3">ISO</T>

      <rect x="1280" y={BAR} width="320" height={H - BAR} className="fill-surface" />
      <line x1="1280" y1={BAR} x2="1280" y2={H} className="stroke-line" />
      <T x={1304} y={84} className="fill-ink" weight={600}>Top plate</T>
      <T x={1576} y={84} anchor="end" size={13} className="fill-ink-3">Version 3</T>
      {params.map(([name, value], i) => (
        <g key={name}>
          <T x={1304} y={134 + i * 56} size={13} className="fill-ink-3">{name}</T>
          <rect x="1420" y={112 + i * 56} width="156" height="36" rx="8" fill="none" className="stroke-line" />
          <T x={1436} y={135 + i * 56} mono size={13} className="fill-ink">{value}</T>
        </g>
      ))}
      <line x1="1280" y1="352" x2="1600" y2="352" className="stroke-line" />
      <T x={1304} y={388} className="fill-ink-3" size={13}>Parts</T>
      {['Base plate', 'Standoff', 'Top plate', 'NEMA 17 motor'].map((name, i) => (
        <g key={name}>
          {i === 2 && <rect x="1292" y={404 + i * 40} width="296" height="34" rx="6" className="fill-raised" />}
          <rect x="1304" y={413 + i * 40} width="16" height="16" rx="4" className={i === 2 ? 'fill-ws-cad' : 'fill-line-strong'} />
          <T x={1332} y={426 + i * 40} className={i === 2 ? 'fill-ink' : 'fill-ink-2'}>{name}</T>
        </g>
      ))}
    </Shell>
  );
}

function FleetMock() {
  const robots = [
    ['AGV-01', 'To dock', 'fill-ws-fleet'],
    ['AGV-02', 'Picking', 'fill-ws-fleet'],
    ['AGV-03', 'Charging', 'fill-ink-3'],
    ['UAV-01', 'Inventory scan', 'fill-ws-ide'],
  ];
  const racks = [
    [470, 150], [470, 330], [470, 510],
    [690, 150], [690, 330], [690, 510],
    [910, 150], [910, 330], [910, 510],
  ];
  return (
    <Shell project="warehouse-b" workspace="Fleet Planner" action="Simulate">
      <rect x="0" y={BAR} width="340" height={H - BAR} className="fill-surface" />
      <line x1="340" y1={BAR} x2="340" y2={H} className="stroke-line" />
      <T x={24} y={84} className="fill-ink" weight={600}>Vehicles</T>
      {robots.map(([name, state, dot], i) => (
        <g key={name}>
          <rect x="24" y={104 + i * 62} width="292" height="50" rx="8" fill="none" className={i === 0 ? 'stroke-ws-fleet' : 'stroke-line'} />
          <circle cx="48" cy={129 + i * 62} r="5" className={dot} />
          <T x={66} y={134 + i * 62} mono size={13} className="fill-ink">{name}</T>
          <T x={298} y={134 + i * 62} anchor="end" size={13} className="fill-ink-3">{state}</T>
        </g>
      ))}
      <T x={24} y={394} className="fill-ink-3" size={13}>Tasks</T>
      {['Move pallet 14 to dock 2', 'Restock aisle C', 'Scan rack 7'].map((task, i) => (
        <g key={task}>
          <circle cx="32" cy={421 + i * 36} r="4" className={i === 0 ? 'fill-busy' : 'fill-line-strong'} />
          <T x={48} y={426 + i * 36} size={13} className={i === 0 ? 'fill-ink' : 'fill-ink-2'}>{task}</T>
        </g>
      ))}

      <rect x="340" y={BAR} width={W - 340} height={H - BAR} className="fill-well" />
      {Array.from({ length: 22 }, (_, i) => (
        <line key={`v${i}`} x1={380 + i * 55} y1="80" x2={380 + i * 55} y2="860" className="stroke-line" strokeOpacity="0.45" />
      ))}
      {Array.from({ length: 15 }, (_, i) => (
        <line key={`h${i}`} x1="380" y1={80 + i * 55} x2="1560" y2={80 + i * 55} className="stroke-line" strokeOpacity="0.45" />
      ))}
      {racks.map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="130" height="110" rx="6" className="fill-surface stroke-ink-3" />
          <line x1={x} y1={y + 37} x2={x + 130} y2={y + 37} className="stroke-line-strong" />
          <line x1={x} y1={y + 73} x2={x + 130} y2={y + 73} className="stroke-line-strong" />
        </g>
      ))}
      <rect x="1250" y="110" width="250" height="120" rx="8" fill="none" className="stroke-line-strong" strokeDasharray="6 6" />
      <T x={1375} y={176} anchor="middle" className="fill-ink-3" size={13}>Dock 2</T>
      <rect x="1250" y="620" width="250" height="150" rx="8" fill="none" className="stroke-line-strong" strokeDasharray="6 6" />
      <T x={1375} y={700} anchor="middle" className="fill-ink-3" size={13}>Charging</T>
      <path d="M430 720 H1160 V172 H1250" fill="none" className="stroke-ws-fleet" strokeWidth="2" strokeDasharray="8 8" />
      <path d="M650 290 V490 H870" fill="none" className="stroke-line-strong" strokeWidth="2" strokeDasharray="8 8" />
      {[[760, 720, 'AGV-01', true], [650, 400, 'AGV-02', false], [1330, 700, 'AGV-03', false]].map(([x, y, name, lead]) => (
        <g key={name as string}>
          <circle cx={x as number} cy={y as number} r="26" className="fill-ws-fleet" fillOpacity={lead ? 0.18 : 0.08} />
          <rect x={(x as number) - 14} y={(y as number) - 14} width="28" height="28" rx="6" className="fill-surface stroke-ws-fleet" strokeWidth="1.6" />
          <T x={(x as number) + 26} y={(y as number) - 22} mono size={12} className="fill-ink-2">{name as string}</T>
        </g>
      ))}
      <circle cx="1040" cy="300" r="30" fill="none" className="stroke-ws-ide" strokeDasharray="4 6" />
      <path d="M1026 286 l28 28 M1054 286 l-28 28" className="stroke-ws-ide" strokeWidth="1.6" />
      <T x={1078} y={282} mono size={12} className="fill-ink-2">UAV-01</T>
    </Shell>
  );
}

export const DEMO_MOCKS: Record<string, () => ReactNode> = {
  ide: IdeMock,
  blocks: BlocksMock,
  cad: CadMock,
  fleet: FleetMock,
};
