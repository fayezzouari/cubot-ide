'use client';

import { Code2, Boxes, Cpu, Zap, Radio, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';

export default function AboutSection() {
  const roboticFeatures = [
    { icon: Cpu, label: 'MCU Support', desc: 'ARM, ESP32, STM32' },
    { icon: Zap, label: 'Real-time I/O', desc: 'GPIO, ADC, PWM' },
    { icon: Radio, label: 'Wireless', desc: 'BLE, WiFi, LoRaWAN' },
    { icon: RotateCcw, label: 'Simulation', desc: 'Real-time execution' },
  ];

  return (
    <section id="about" className="py-24 px-6 bg-background">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-3">
            Two Paths
          </h2>
          <p className="text-lg text-muted-foreground">
            Choose your learning style
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-20">
          {/* Code-Based Editor */}
          <div className="p-6 border border-border bg-card rounded-lg">
            <div className="flex items-start gap-4 mb-6 pb-6 border-b border-border">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Code2 size={24} className="text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground">Code Editor</h3>
                <p className="text-sm text-muted-foreground mt-1">Professional Development</p>
              </div>
            </div>
            <p className="text-foreground/90 leading-relaxed mb-6">
              Write embedded C/C++ with full IDE features, AI autocompletion, and cross-platform compilation for multiple microcontrollers.
            </p>
            <ul className="space-y-2.5 text-sm text-foreground">
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                Full IDE with debugging
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                Cross-compiler support
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                Real hardware deployment
              </li>
            </ul>
          </div>

          {/* No-Code Solution */}
          <div className="p-6 border border-border bg-card rounded-lg">
            <div className="flex items-start gap-4 mb-6 pb-6 border-b border-border">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Boxes size={24} className="text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground">Block Builder</h3>
                <p className="text-sm text-muted-foreground mt-1">Visual Programming</p>
              </div>
            </div>
            <p className="text-foreground/90 leading-relaxed mb-6">
              Drag-and-drop blocks to control motors, sensors, and actuators. Perfect for beginners and robotics competitions.
            </p>
            <ul className="space-y-2.5 text-sm text-foreground">
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                Drag-and-drop interface
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                Live sensor feedback
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                Instant compilation
              </li>
            </ul>
          </div>
        </div>

        {/* Supported Robotics Features */}
        <div className="mb-20">
          <h3 className="text-3xl font-semibold text-foreground mb-8">
            Embedded Features
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {roboticFeatures.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={i}
                  className="p-5 bg-card border border-border rounded-lg text-center hover:border-primary/50 transition-colors"
                >
                  <div className="w-10 h-10 bg-primary/10 rounded-lg mx-auto mb-3 flex items-center justify-center">
                    <Icon size={20} className="text-primary" />
                  </div>
                  <p className="font-semibold text-foreground text-sm mb-1">{feature.label}</p>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Virtual Hardware Grid */}
        <div>
          <h3 className="text-3xl font-semibold text-foreground mb-8">
            Supported Microcontrollers
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'ARM Cortex-M4', chip: 'STM32F4' },
              { name: 'ESP32', chip: 'Xtensa' },
              { name: 'STM32L476', chip: 'Cortex-M4' },
              { name: 'Arduino Nano', chip: 'ATmega328P' },
            ].map((mcu, i) => (
              <div
                key={i}
                className="p-5 bg-card border border-border rounded-lg text-center hover:border-primary/50 transition-colors"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-lg mx-auto mb-3 flex items-center justify-center">
                  <Cpu size={20} className="text-primary" />
                </div>
                <p className="font-semibold text-foreground text-sm mb-1">{mcu.name}</p>
                <p className="text-xs text-muted-foreground">{mcu.chip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
