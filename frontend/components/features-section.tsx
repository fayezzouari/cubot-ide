'use client';

import { Cpu, Zap, Gamepad2, BookOpen, BarChart3, Shield } from 'lucide-react';

const features = [
  {
    icon: Cpu,
    title: 'MCU Simulator',
    description: 'Run code on virtual microcontrollers with accurate peripheral simulation — GPIO, ADC, PWM, UART.',
  },
  {
    icon: Zap,
    title: 'AI Code Assistant',
    description: 'Real-time intelligent suggestions for embedded C/C++, circuit logic, and robotics implementations.',
  },
  {
    icon: Gamepad2,
    title: 'Sensor & Motor Control',
    description: 'Simulate motors, servos, sensors, and actuators with realistic physics and feedback loops.',
  },
  {
    icon: BookOpen,
    title: 'Interactive Tutorials',
    description: 'Guided projects from LED blinking to complete robot control systems with step-by-step walkthroughs.',
  },
  {
    icon: BarChart3,
    title: 'Performance Metrics',
    description: 'Monitor CPU usage, memory footprint, execution time, and power consumption in real-time.',
  },
  {
    icon: Shield,
    title: 'Safe Sandbox',
    description: 'Experiment freely — test every idea on virtual hardware before deploying to physical boards.',
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6 border-t border-border">
      <div className="max-w-6xl mx-auto">

        {/* Section header */}
        <div className="mb-16">
          <p className="text-xs font-mono text-primary mb-3 tracking-widest uppercase">Capabilities</p>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4 tracking-tight">
            Everything you need
          </h2>
          <p className="text-muted-foreground text-sm max-w-md">
            A complete environment for embedded software development, from simulation to deployment.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden">
          {features.map(({ icon: Icon, title, description }, index) => (
            <div
              key={index}
              className="group p-6 bg-background hover:bg-card transition-colors relative"
            >
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 border border-border rounded-md flex items-center justify-center text-primary mt-0.5 flex-shrink-0 group-hover:border-primary/50 transition-colors">
                  <Icon size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                </div>
              </div>
              {/* Subtle number */}
              <span className="absolute top-4 right-5 text-xs font-mono text-border select-none">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
          ))}
        </div>

        {/* Platforms strip */}
        <div className="mt-16 pt-12 border-t border-border">
          <p className="text-xs font-mono text-muted-foreground mb-6 tracking-widest uppercase text-center">
            Supported Platforms
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {['LEGO Mindstorms', 'ROSbot 2 Pro', 'Arduino', 'Custom Drones', 'Raspberry Pi', 'STM32 Nucleo'].map((platform) => (
              <span key={platform} className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono">
                {platform}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
