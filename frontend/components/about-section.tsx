'use client';

import { Code2, Boxes, Cpu, Zap, Radio, RotateCcw, Check } from 'lucide-react';

export default function AboutSection() {
  const embeddedFeatures = [
    { icon: Cpu, label: 'MCU Support', desc: 'ARM, ESP32, STM32' },
    { icon: Zap, label: 'Real-time I/O', desc: 'GPIO, ADC, PWM' },
    { icon: Radio, label: 'Wireless', desc: 'BLE, WiFi, LoRaWAN' },
    { icon: RotateCcw, label: 'Simulation', desc: 'Real-time execution' },
  ];

  return (
    <section id="about" className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">

        <div className="mb-16">
          <p className="text-xs font-mono text-white/30 mb-3 tracking-widest uppercase">Platform</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Two ways to build
          </h2>
          <p className="text-white/40 text-sm max-w-md">
            Choose the workflow that fits your skill level. Switch between them anytime.
          </p>
        </div>

        {/* Two paths */}
        <div className="grid md:grid-cols-2 gap-3 mb-20">
          {[
            {
              icon: Code2,
              title: 'Code Editor',
              subtitle: 'Professional Development',
              desc: 'Write embedded C/C++ with full IDE features, AI autocompletion, and cross-platform compilation for multiple microcontrollers.',
              items: ['Full IDE with AI assistance', 'Cross-compiler support', 'Real hardware deployment'],
            },
            {
              icon: Boxes,
              title: 'Block Builder',
              subtitle: 'Visual Programming',
              desc: 'Drag-and-drop blocks to control motors, sensors, and actuators. Perfect for beginners and robotics competitions.',
              items: ['Drag-and-drop interface', 'Live sensor feedback', 'Instant compilation'],
            },
          ].map(({ icon: Icon, title, subtitle, desc, items }) => (
            <div key={title} className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.03] transition-all">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-white/60">
                  <Icon size={16} />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">{title}</h3>
                  <p className="text-xs text-white/30">{subtitle}</p>
                </div>
              </div>
              <p className="text-sm text-white/40 leading-relaxed mb-5">{desc}</p>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-xs text-white/50">
                    <Check size={11} className="text-white/30 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Embedded Features */}
        <div className="mb-20">
          <p className="text-xs font-mono text-white/25 mb-6 tracking-widest uppercase">Embedded Features</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {embeddedFeatures.map(({ icon: Icon, label, desc }, i) => (
              <div key={i} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] transition-colors">
                <div className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 mb-3">
                  <Icon size={14} />
                </div>
                <p className="text-xs font-semibold text-white/70 mb-0.5">{label}</p>
                <p className="text-xs text-white/30">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* MCUs */}
        <div>
          <p className="text-xs font-mono text-white/25 mb-6 tracking-widest uppercase">Supported Microcontrollers</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'ARM Cortex-M4', chip: 'STM32F4' },
              { name: 'ESP32', chip: 'Xtensa LX6' },
              { name: 'STM32L476', chip: 'Cortex-M4' },
              { name: 'Arduino Nano', chip: 'ATmega328P' },
            ].map((mcu, i) => (
              <div key={i} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] transition-colors">
                <div className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 mb-3">
                  <Cpu size={14} />
                </div>
                <p className="text-xs font-semibold text-white/70 mb-0.5">{mcu.name}</p>
                <p className="text-xs text-white/30 font-mono">{mcu.chip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
