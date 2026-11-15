'use client';

import { useState } from 'react';
import { Code2, Boxes, Box, Check, Route } from 'lucide-react';
import { DEMO_MOCKS } from '@/components/demo-mocks';

const demos = [
  {
    id: 'ide',
    icon: Code2,
    label: 'Code IDE',
    tagline: 'ROS and embedded development',
    description: 'A full Monaco editor with AI chat, multi-compiler support, and real-time serial monitoring. Write ROS nodes or embedded C/C++ firmware, then deploy directly to hardware or robots.',
    bullets: [
      'AI assistant with Vibe & Plan modes',
      'ROS package development and Arduino/ESP32/STM32 firmware',
      'Serial monitor over WebSocket for embedded debugging',
      'Flash HEX binaries to real hardware from the browser',
    ],
    tint: 'text-ws-ide',
  },
  {
    id: 'blocks',
    icon: Boxes,
    label: 'Block Builder',
    tagline: 'Visual programming for robotics',
    description: 'Drag-and-drop node-based programming with a live 3D robotic arm viewer. Connect blocks to control motors, loops, and sensors — no syntax required.',
    bullets: [
      'Drag-and-drop blocks: loops, conditions, joint moves',
      'Live 3D 6-DOF arm visualization with IK',
      'Real-time sequential program execution',
      'Auto-save with persistent program history',
    ],
    tint: 'text-ws-blocks',
  },
  {
    id: 'cad',
    icon: Box,
    label: 'CAD Designer',
    tagline: 'AI-generated 3D models',
    description: 'Describe any part in plain language. CuBot plans a multi-part assembly, generates CadQuery Python, validates each piece, and streams a live 3D preview.',
    bullets: [
      'Natural language → parametric 3D model',
      'Multi-part assembly with AI planning',
      'STL export for 3D printing or machining',
      'Iterative design via conversation',
    ],
    tint: 'text-ws-cad',
  },
  {
    id: 'fleet',
    icon: Route,
    label: 'Fleet Planner',
    tagline: 'Multi-robot coordination',
    description: 'Draw a warehouse, drop in ground robots, drones and tasks, and let CuBot plan the paths and assign the work. The same workspace drives a simulated fleet or real hardware over VDA 5050.',
    bullets: [
      'A*, Theta*, Dijkstra, RRT and RRT* path planning',
      'Deadline-aware task assignment',
      'Simulated or live fleets over MQTT',
      'Connect real vehicles with cubot-sdk',
    ],
    tint: 'text-ws-fleet',
  },
];

export default function DemoSection() {
  const [active, setActive] = useState('ide');
  const current = demos.find(d => d.id === active)!;
  const Mock = DEMO_MOCKS[current.id];

  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)] gap-10 lg:gap-12 items-center">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
            See it for yourself.
          </h2>
          <p className="text-ink-2 text-sm max-w-md leading-relaxed mb-8">
            Switch between workspaces to see CuBot in action — from writing firmware
            to building 3D parts with a conversation.
          </p>

          <div className="flex flex-wrap lg:flex-col gap-1 p-1 mb-8 rounded-xl border border-line bg-surface w-fit lg:w-full">
            {demos.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                aria-pressed={active === id}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2 ${
                  active === id
                    ? 'bg-ink text-page'
                    : 'text-ink-2 hover:text-ink hover:bg-raised'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <current.icon size={15} className={current.tint} />
            <h3 className="text-sm font-semibold text-ink">{current.label}</h3>
            <span className="text-sm text-ink-3">{current.tagline}</span>
          </div>
          <p className="text-sm text-ink-2 leading-relaxed mb-5">{current.description}</p>
          <ul className="space-y-2.5">
            {current.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-ink-2">
                <Check size={13} className="text-ink-3 flex-shrink-0 mt-1" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-line-strong bg-surface overflow-hidden">
          <div className="h-8 bg-well border-b border-line flex items-center px-3 gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
            <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
            <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
            <span className="ml-4 text-xs text-ink-3">cubot.dev/{current.id}</span>
          </div>
          <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
            <Mock />
          </div>
        </div>
      </div>
    </section>
  );
}
