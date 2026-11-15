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
    description: 'Provision Kubernetes sandbox pods for full ROS development. Integrated terminal, file sync between IDE and sandbox, and full package build support.',
    detail: 'Kubernetes sandboxes',
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">

        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
            Built for the full<br />development loop.
          </h2>
          <p className="text-ink-3 text-sm max-w-md leading-relaxed">
            From first line of code to physical hardware — every step is covered,
            AI-assisted, and runs entirely in your browser.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden">
          {features.map(({ icon: Icon, title, description, detail }, index) => (
            <div
              key={index}
              className="group p-6 bg-surface hover:bg-raised transition-colors relative"
            >
              <div className="mb-5">
                <div className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-ink-3 mb-4 group-hover:border-line-strong transition-colors">
                  <Icon size={14} />
                </div>
                <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
                <p className="text-xs text-ink-3 leading-relaxed">{description}</p>
              </div>
              <span className="inline-flex items-center text-xs text-ink-3 border border-line px-2 py-0.5 rounded-lg">
                {detail}
              </span>
            </div>
          ))}
        </div>

        {/* Supported platforms */}
        <div className="mt-14 pt-10 border-t border-line">
          <p className="text-xs text-ink-3 mb-6 text-center">
            Supported Hardware
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {['Arduino', 'ESP32', 'STM32 Nucleo', 'ROSbot 2 Pro', 'LEGO Mindstorms', 'Raspberry Pi'].map((p) => (
              <span key={p} className="text-xs text-ink-3 hover:text-ink-3 transition-colors cursor-default">
                {p}
              </span>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
