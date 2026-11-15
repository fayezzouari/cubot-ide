'use client';

import { Code2, Boxes, Box, Check, Cpu, Zap, Radio, RotateCcw, Route } from 'lucide-react';

const workspaces = [
  {
    icon: Code2,
    title: 'Code IDE',
    subtitle: 'ROS & Embedded Development',
    desc: 'A full Monaco-based editor with AI chat, multi-compiler support, and serial monitoring. Write ROS nodes or embedded C/C++ with Claude-powered suggestions, then deploy to hardware or robots.',
    items: [
      'Monaco editor with AI code assistant',
      'ROS packages & Arduino/ESP32/STM32 firmware',
      'Serial monitor over WebSocket',
      'Deploy to robots and hardware from browser',
    ],
    tag: '/ide',
  },
  {
    icon: Boxes,
    title: 'Block Builder',
    subtitle: 'Visual Programming',
    desc: 'Drag-and-drop programming with a live 6-DOF robotic arm viewer. Connect blocks to control motors, loops, and sensors — no syntax required. Perfect for learning and competitions.',
    items: [
      'Drag-and-drop node-based editor',
      'Real-time 3D arm visualization',
      'Motor, sensor & timing blocks',
      'Auto-save with program history',
    ],
    tag: '/blocks',
  },
  {
    icon: Box,
    title: 'CAD Designer',
    subtitle: 'AI-Powered 3D Modeling',
    desc: 'Describe the part you need in plain language. CuBot generates parametric CadQuery Python code, renders a 3D preview, and exports STL for 3D printing or assembly.',
    items: [
      'Natural language → 3D model',
      'Multi-part assembly planning',
      'STL export for 3D printing',
      'Iterative design with AI chat',
    ],
    tag: '/cad',
  },
  {
    icon: Route,
    title: 'Fleet Planner',
    subtitle: 'Multi-Robot Coordination',
    desc: 'Draw a warehouse, drop in ground robots, drones and tasks, and let CuBot plan the paths and assign the work. The same workspace drives a simulated fleet or real hardware over VDA 5050.',
    items: [
      'A*, Theta*, Dijkstra, RRT and RRT* path planning',
      'Deadline-aware task assignment',
      'Simulated or live fleets over MQTT',
      'Connect real vehicles with cubot-sdk',
    ],
    tag: '/fleet',
  },
];


const TINTS: Record<string, string> = {
  '/ide': 'text-ws-ide bg-ws-ide/10 border-ws-ide/25',
  '/blocks': 'text-ws-blocks bg-ws-blocks/10 border-ws-blocks/25',
  '/cad': 'text-ws-cad bg-ws-cad/10 border-ws-cad/25',
  '/fleet': 'text-ws-fleet bg-ws-fleet/10 border-ws-fleet/25',
};

const mcus = [
  { name: 'Arduino', chip: 'ATmega328P', color: 'text-ws-cad' },
  { name: 'ESP32 (Upcoming)', chip: 'Xtensa LX6', color: 'text-ws-ide' },
  { name: 'STM32F4 (Upcoming)', chip: 'ARM Cortex-M4', color: 'text-ws-fleet' },
  { name: 'STM32L476 (Upcoming)', chip: 'Cortex-M4 LP', color: 'text-ws-blocks' },
];

export default function AboutSection() {
  return (
    <section id="about" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
            Four workspaces.<br />One platform.
          </h2>
          <p className="text-ink-3 text-sm max-w-md leading-relaxed">
            Switch between a pro code editor, visual block builder, AI CAD designer
            and fleet planner — all connected to the same project.
          </p>
        </div>

        {/* Workspace cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-20">
          {workspaces.map(({ icon: Icon, title, subtitle, desc, items, tag }) => (
            <div
              key={title}
              className="group p-6 rounded-xl border border-line bg-surface hover:border-line-strong hover:bg-raised transition-all relative overflow-hidden"
            >
              {/* Subtle glow on hover */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at top left, rgba(255,255,255,0.02), transparent 70%)' }} />

              <div className="flex items-center gap-3 mb-5">
                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${TINTS[tag] ?? 'border-line bg-raised text-ink-2'}`}>
                  <Icon size={16} />
                </div>
                <div>
                  <h3 className="font-semibold text-ink text-sm">{title}</h3>
                  <p className="text-xs text-ink-3">{subtitle}</p>
                </div>
              </div>

              <p className="text-sm text-ink-3 leading-relaxed mb-5">{desc}</p>

              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-xs text-ink-3">
                    <Check size={10} className="text-ink-3 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>

              <span className="absolute bottom-4 right-5 text-xs text-line-strong select-none">{tag}</span>
            </div>
          ))}
        </div>

       

        {/* MCU grid */}
        <div>
          <p className="text-xs text-ink-3 mb-6">Supported Microcontrollers</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {mcus.map(({ name, chip, color }) => (
              <div key={name} className="p-4 rounded-xl border border-line bg-surface hover:border-line-strong transition-colors group">
                <div className="w-8 h-8 rounded-lg border border-line flex items-center justify-center mb-3">
                  <Cpu size={14} className={`${color} group-hover:opacity-80 transition-opacity`} />
                </div>
                <p className="text-xs font-semibold text-ink-2 mb-0.5">{name}</p>
                <p className="text-xs text-ink-3">{chip}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
