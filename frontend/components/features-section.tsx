'use client';

import { Cpu, Zap, Gamepad2, BookOpen, BarChart3, Shield } from 'lucide-react';

const features = [
  { icon: Cpu, title: 'MCU Simulator', description: 'Run code on virtual microcontrollers with accurate peripheral simulation — GPIO, ADC, PWM, UART.' },
  { icon: Zap, title: 'AI Code Assistant', description: 'Real-time intelligent suggestions for embedded C/C++, circuit logic, and robotics implementations.' },
  { icon: Gamepad2, title: 'Sensor & Motor Control', description: 'Simulate motors, servos, sensors, and actuators with realistic physics and feedback loops.' },
  { icon: BookOpen, title: 'Interactive Tutorials', description: 'Guided projects from LED blinking to complete robot control systems with step-by-step walkthroughs.' },
  { icon: BarChart3, title: 'Performance Metrics', description: 'Monitor CPU usage, memory footprint, execution time, and power consumption in real-time.' },
  { icon: Shield, title: 'Safe Sandbox', description: 'Experiment freely — test every idea on virtual hardware before deploying to physical boards.' },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">

        <div className="mb-16">
          <p className="text-xs font-mono text-white/30 mb-3 tracking-widest uppercase">Capabilities</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Everything you need
          </h2>
          <p className="text-white/40 text-sm max-w-md">
            A complete environment for embedded software development, from simulation to deployment.
          </p>
        </div>

        {/* Feature grid — connected with gap-px borders */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.04] rounded-xl overflow-hidden">
          {features.map(({ icon: Icon, title, description }, index) => (
            <div
              key={index}
              className="group p-6 bg-black hover:bg-white/[0.02] transition-colors relative"
            >
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 mt-0.5 flex-shrink-0 group-hover:border-white/[0.14] transition-colors">
                  <Icon size={14} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white/80 mb-2">{title}</h3>
                  <p className="text-xs text-white/35 leading-relaxed">{description}</p>
                </div>
              </div>
              <span className="absolute top-4 right-5 text-[10px] font-mono text-white/10 select-none">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
          ))}
        </div>

        {/* Platforms */}
        <div className="mt-14 pt-10 border-t border-white/[0.04]">
          <p className="text-xs font-mono text-white/20 mb-6 tracking-widest uppercase text-center">
            Supported Platforms
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {['LEGO Mindstorms', 'ROSbot 2 Pro', 'Arduino', 'Custom Drones', 'Raspberry Pi', 'STM32 Nucleo'].map((p) => (
              <span key={p} className="text-xs text-white/25 hover:text-white/50 transition-colors font-mono">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
