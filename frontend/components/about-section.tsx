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
    <section id="about" className="py-24 px-6 border-t border-border">
      <div className="max-w-6xl mx-auto">

        {/* Section header */}
        <div className="mb-16">
          <p className="text-xs font-mono text-primary mb-3 tracking-widest uppercase">Platform</p>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4 tracking-tight">
            Two ways to build
          </h2>
          <p className="text-muted-foreground text-sm max-w-md">
            Choose the workflow that fits your skill level. Switch between them anytime.
          </p>
        </div>

        {/* Two paths */}
        <div className="grid md:grid-cols-2 gap-4 mb-20">
          {/* Code Editor */}
          <div className="group p-6 border border-border rounded-lg bg-card hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 border border-border rounded-md flex items-center justify-center text-primary bg-primary/5">
                <Code2 size={18} />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Code Editor</h3>
                <p className="text-xs text-muted-foreground">Professional Development</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              Write embedded C/C++ with full IDE features, AI autocompletion, and cross-platform compilation for multiple microcontrollers.
            </p>
            <ul className="space-y-2">
              {['Full IDE with AI assistance', 'Cross-compiler support', 'Real hardware deployment'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-xs text-foreground/80">
                  <Check size={12} className="text-primary flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Block Builder */}
          <div className="group p-6 border border-border rounded-lg bg-card hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 border border-border rounded-md flex items-center justify-center text-primary bg-primary/5">
                <Boxes size={18} />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Block Builder</h3>
                <p className="text-xs text-muted-foreground">Visual Programming</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              Drag-and-drop blocks to control motors, sensors, and actuators. Perfect for beginners and robotics competitions.
            </p>
            <ul className="space-y-2">
              {['Drag-and-drop interface', 'Live sensor feedback', 'Instant compilation'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-xs text-foreground/80">
                  <Check size={12} className="text-primary flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Embedded Features */}
        <div className="mb-20">
          <p className="text-xs font-mono text-muted-foreground mb-6 tracking-widest uppercase">Embedded Features</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {embeddedFeatures.map(({ icon: Icon, label, desc }, i) => (
              <div
                key={i}
                className="p-4 border border-border rounded-lg bg-card hover:border-primary/30 transition-colors"
              >
                <div className="w-8 h-8 border border-border rounded-md flex items-center justify-center text-primary mb-3">
                  <Icon size={15} />
                </div>
                <p className="text-xs font-semibold text-foreground mb-0.5">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Supported MCUs */}
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-6 tracking-widest uppercase">Supported Microcontrollers</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'ARM Cortex-M4', chip: 'STM32F4' },
              { name: 'ESP32', chip: 'Xtensa LX6' },
              { name: 'STM32L476', chip: 'Cortex-M4' },
              { name: 'Arduino Nano', chip: 'ATmega328P' },
            ].map((mcu, i) => (
              <div
                key={i}
                className="p-4 border border-border rounded-lg bg-card hover:border-primary/30 transition-colors"
              >
                <div className="w-8 h-8 border border-border rounded-md flex items-center justify-center text-primary mb-3">
                  <Cpu size={15} />
                </div>
                <p className="text-xs font-semibold text-foreground mb-0.5">{mcu.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{mcu.chip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
