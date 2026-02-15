'use client';

import {
  Zap,
  BookOpen,
  Lightbulb,
  Share2,
  BarChart3,
  Shield,
  Cpu,
  Smartphone,
  Gamepad2,
  Lock,
} from 'lucide-react';

const features = [
  {
    icon: Cpu,
    title: 'MCU Simulator',
    description: 'Run code on virtual microcontrollers with accurate peripheral simulation including GPIO, ADC, PWM, and UART.',
  },
  {
    icon: Zap,
    title: 'AI Code Assistant',
    description: 'Get real-time intelligent suggestions for embedded C/C++ code, circuit logic, and robotics implementations.',
  },
  {
    icon: Gamepad2,
    title: 'Sensor & Motor Control',
    description: 'Simulate motors, servos, sensors, and actuators with realistic physics and feedback.',
  },
  {
    icon: BookOpen,
    title: 'Interactive Tutorials',
    description: 'Guided projects from LED blinking to complete robot control systems with step-by-step instructions.',
  },
  {
    icon: BarChart3,
    title: 'Performance Metrics',
    description: 'Monitor CPU usage, memory footprint, execution time, and power consumption in real-time.',
  },
  {
    icon: Shield,
    title: 'Safe Sandbox',
    description: 'Experiment without fear of hardware damage. Test every idea before deploying to physical boards.',
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-3">
            Capabilities
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to code robots
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="p-6 border border-border bg-card rounded-lg hover:border-primary/50 transition-colors"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-lg mb-4 flex items-center justify-center">
                  <Icon size={24} className="text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-sm">{feature.description}</p>
              </div>
            );
          })}
        </div>

        {/* Robotics Platforms */}
        <div className="pt-12">
          <h3 className="text-3xl font-semibold text-foreground mb-8">
            Supported Platforms
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'LEGO Mindstorms', type: 'EV3/Spike' },
              { name: 'ROSbot', type: 'ROS2' },
              { name: 'Arduino', type: 'All Models' },
              { name: 'Custom Drones', type: 'Multi-rotor' },
            ].map((platform, i) => (
              <div key={i} className="p-5 bg-card border border-border rounded-lg text-center hover:border-primary/50 transition-colors">
                <div className="w-10 h-10 bg-primary/10 rounded-lg mx-auto mb-3 flex items-center justify-center">
                  <Smartphone size={20} className="text-primary" />
                </div>
                <p className="font-semibold text-foreground text-sm mb-1">{platform.name}</p>
                <p className="text-xs text-muted-foreground">{platform.type}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
