'use client';

import { Code2, Boxes, Box, Check, Cpu, Zap, Radio, RotateCcw } from 'lucide-react';

const workspaces = [
  {
    icon: Code2,
    title: 'Code IDE',
    subtitle: 'Professional Development',
    desc: 'A full Monaco-based editor with AI chat, multi-compiler support, and serial monitoring. Write embedded C/C++ with Claude-powered suggestions, then deploy directly to hardware.',
    items: [
      'Monaco editor with AI code assistant',
      'Compile for Arduino, ESP32 & STM32',
      'Serial monitor over WebSocket',
      'Upload HEX files to real hardware',
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
];


const mcus = [
  { name: 'Arduino', chip: 'ATmega328P', color: 'text-green-400/40' },
  { name: 'ESP32', chip: 'Xtensa LX6', color: 'text-blue-400/40' },
  { name: 'STM32F4', chip: 'ARM Cortex-M4', color: 'text-purple-400/40' },
  { name: 'STM32L476', chip: 'Cortex-M4 LP', color: 'text-orange-400/40' },
];

export default function AboutSection() {
  return (
    <section id="about" className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-16">
          <p className="text-xs font-mono text-white/30 mb-3 tracking-widest uppercase">Platform</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Three workspaces.<br />One platform.
          </h2>
          <p className="text-white/40 text-sm max-w-md leading-relaxed">
            Switch between a pro code editor, visual block builder, and AI CAD designer
            — all connected to the same project.
          </p>
        </div>

        {/* Workspace cards */}
        <div className="grid md:grid-cols-3 gap-3 mb-20">
          {workspaces.map(({ icon: Icon, title, subtitle, desc, items, tag }) => (
            <div
              key={title}
              className="group p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.03] transition-all relative overflow-hidden"
            >
              {/* Subtle glow on hover */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at top left, rgba(255,255,255,0.02), transparent 70%)' }} />

              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-white/50">
                  <Icon size={16} />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">{title}</h3>
                  <p className="text-xs text-white/30">{subtitle}</p>
                </div>
              </div>

              <p className="text-sm text-white/35 leading-relaxed mb-5">{desc}</p>

              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-xs text-white/45">
                    <Check size={10} className="text-white/25 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>

              <span className="absolute bottom-4 right-5 text-[10px] font-mono text-white/10 select-none">{tag}</span>
            </div>
          ))}
        </div>

       

        {/* MCU grid */}
        <div>
          <p className="text-xs font-mono text-white/20 mb-6 tracking-widest uppercase">Supported Microcontrollers</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {mcus.map(({ name, chip, color }) => (
              <div key={name} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] transition-colors group">
                <div className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center mb-3">
                  <Cpu size={14} className={`${color} group-hover:opacity-80 transition-opacity`} />
                </div>
                <p className="text-xs font-semibold text-white/60 mb-0.5">{name}</p>
                <p className="text-xs text-white/30 font-mono">{chip}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
