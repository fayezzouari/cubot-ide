'use client';

import { BrainCircuit, Wrench, Cpu, Grip, Box, Terminal } from 'lucide-react';

const features = [
  {
    icon: BrainCircuit,
    title: 'AI Code Assistant',
    description: 'Claude-powered assistant with two modes: Vibe Mode for instant suggestions, and Plan Mode for structured multi-step code generation with accept/discard controls.',
    detail: 'Powered by AWS Bedrock',
  },
  {
    icon: Wrench,
    title: 'Multi-Target Compiler',
    description: 'Docker-containerized compilers for Arduino, TI ARM, and ESP32. One-click cross-compilation with real-time build logs, error parsing, and AI-explained diagnostics.',
    detail: 'Arduino · TI ARM · ESP32',
  },
  {
    icon: Cpu,
    title: 'Hardware Simulation',
    description: 'Run compiled HEX files on a virtual ATmega328P via AVR8js. Simulate GPIO, ADC, PWM, UART, and interrupts without touching a single wire.',
    detail: 'ATmega328P emulator',
  },
  {
    icon: Grip,
    title: 'Visual Block Programming',
    description: 'Build robot programs by connecting drag-and-drop blocks — loops, conditions, joint moves, timing. A live 3D arm viewer reflects every change in real time.',
    detail: '6-DOF arm · XYFlow engine',
  },
  {
    icon: Box,
    title: 'AI CAD Designer',
    description: 'Describe the 3D part you need in plain English. CuBot plans a multi-part assembly, generates CadQuery Python, validates each part, and streams the model live.',
    detail: 'CadQuery · STL export',
  },
  {
    icon: Terminal,
    title: 'ROS Development',
    description: 'Provision cloud sandboxes via Daytona for full ROS development. Integrated terminal, file sync between IDE and sandbox, and full package build support.',
    detail: 'Daytona sandboxes',
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">

        <div className="mb-16">
          <p className="text-xs font-mono text-white/30 mb-3 tracking-widest uppercase">Capabilities</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Built for the full<br />development loop.
          </h2>
          <p className="text-white/40 text-sm max-w-md leading-relaxed">
            From first line of code to physical hardware — every step is covered,
            AI-assisted, and runs entirely in your browser.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.04] rounded-xl overflow-hidden">
          {features.map(({ icon: Icon, title, description, detail }, index) => (
            <div
              key={index}
              className="group p-6 bg-black hover:bg-white/[0.02] transition-colors relative"
            >
              <div className="mb-5">
                <div className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 mb-4 group-hover:border-white/[0.15] transition-colors">
                  <Icon size={14} />
                </div>
                <h3 className="text-sm font-semibold text-white/85 mb-2">{title}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{description}</p>
              </div>
              <span className="inline-flex items-center text-[10px] font-mono text-white/20 border border-white/[0.06] px-2 py-0.5 rounded-md">
                {detail}
              </span>
              <span className="absolute top-4 right-5 text-[10px] font-mono text-white/10 select-none">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
          ))}
        </div>

        {/* Supported platforms */}
        <div className="mt-14 pt-10 border-t border-white/[0.04]">
          <p className="text-xs font-mono text-white/20 mb-6 tracking-widest uppercase text-center">
            Supported Hardware
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {['Arduino', 'ESP32', 'STM32 Nucleo', 'ROSbot 2 Pro', 'LEGO Mindstorms', 'Raspberry Pi'].map((p) => (
              <span key={p} className="text-xs text-white/20 hover:text-white/45 transition-colors font-mono cursor-default">
                {p}
              </span>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
