'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Code2, Boxes, Box, Check } from 'lucide-react';

const demos = [
  {
    id: 'ide',
    icon: Code2,
    label: 'Code IDE',
    tagline: 'Professional embedded development',
    description: 'A full Monaco editor with AI chat, multi-compiler support, and real-time serial monitoring. Write embedded C/C++ then deploy directly to hardware.',
    image: '/jde-demo.png',
    bullets: [
      'Claude-powered AI assistant with Vibe & Plan modes',
      'Compile for Arduino, ESP32, and STM32 with one click',
      'Serial monitor over WebSocket',
      'Flash HEX binaries to real hardware',
    ],
    badge: 'AI-assisted',
    badgeColor: 'text-blue-400/60 border-blue-400/20',
  },
  {
    id: 'blocks',
    icon: Boxes,
    label: 'Block Builder',
    tagline: 'Visual programming for robotics',
    description: 'Drag-and-drop node-based programming with a live 3D robotic arm viewer. Connect blocks to control motors, loops, and sensors — no syntax required.',
    image: '/block-demo.png',
    bullets: [
      'Drag-and-drop blocks: loops, conditions, joint moves',
      'Live 3D 6-DOF arm visualization with IK',
      'Real-time sequential program execution',
      'Auto-save with persistent program history',
    ],
    badge: 'Visual',
    badgeColor: 'text-green-400/60 border-green-400/20',
  },
  {
    id: 'cad',
    icon: Box,
    label: 'CAD Designer',
    tagline: 'AI-generated 3D models',
    description: 'Describe any part in plain language. CuBot plans a multi-part assembly, generates CadQuery Python, validates each piece, and streams a live 3D preview.',
    image: '/cad-demo.png',
    bullets: [
      'Natural language → parametric 3D model',
      'Multi-part assembly with AI planning',
      'STL export for 3D printing or machining',
      'Iterative design via conversation',
    ],
    badge: 'AI-generated',
    badgeColor: 'text-purple-400/60 border-purple-400/20',
  },
];

export default function DemoSection() {
  const [active, setActive] = useState('ide');
  const current = demos.find(d => d.id === active)!;

  return (
    <section className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-12">
          <p className="text-xs font-mono text-white/30 mb-3 tracking-widest uppercase">In Action</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            See it for yourself.
          </h2>
          <p className="text-white/40 text-sm max-w-md leading-relaxed">
            Switch between workspaces to see CuBot in action — from writing firmware
            to building 3D parts with a conversation.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 mb-8 p-1 rounded-xl border border-white/[0.06] bg-white/[0.02] w-fit">
          {demos.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                active === id
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Demo card */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">

          {/* Screenshot */}
          <div className="relative w-full bg-black border-b border-white/[0.06]" style={{ aspectRatio: '16/9' }}>
            {/* Browser chrome */}
            <div className="absolute top-0 left-0 right-0 h-8 bg-[#0a0a0a] border-b border-white/[0.06] flex items-center px-3 gap-1.5 z-10">
              <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
              <span className="ml-4 text-[10px] font-mono text-white/20">cubot.dev/{current.id}</span>
            </div>

            <Image
              src={current.image}
              alt={`${current.label} screenshot`}
              fill
              className="object-cover object-top pt-8"
              sizes="(max-width: 1280px) 100vw, 1152px"
            />

            {/* Gradient fade at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

            {/* Badge overlay */}
            <div className="absolute top-12 right-4 z-10">
              <span className={`text-[10px] font-mono px-2 py-1 rounded-md border bg-black/60 backdrop-blur-sm ${current.badgeColor}`}>
                {current.badge}
              </span>
            </div>
          </div>

          {/* Info panel */}
          <div className="grid md:grid-cols-2 gap-8 p-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <current.icon size={14} className="text-white/40" />
                <h3 className="text-sm font-semibold text-white">{current.label}</h3>
                <span className="text-xs text-white/30">—</span>
                <span className="text-xs text-white/30">{current.tagline}</span>
              </div>
              <p className="text-sm text-white/40 leading-relaxed">{current.description}</p>
            </div>
            <ul className="space-y-2.5">
              {current.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-xs text-white/50">
                  <Check size={11} className="text-white/25 flex-shrink-0 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </section>
  );
}
