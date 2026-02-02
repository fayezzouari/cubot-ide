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
    <section id="features" className="py-24 px-6 bg-background border-t-8 border-foreground">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-6xl md:text-7xl font-black text-foreground mb-4 font-sans">
          CAPABILITIES
        </h2>
        <p className="text-lg font-bold text-foreground mb-16 border-l-8 border-foreground pl-6">
          EVERYTHING YOU NEED TO CODE ROBOTS
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="p-8 border-4 border-foreground bg-background"
              >
                <div className="w-16 h-16 bg-foreground border-4 border-foreground mb-6 flex items-center justify-center">
                  <Icon size={32} className="text-background" />
                </div>
                <h3 className="text-xl font-black text-foreground mb-3 font-sans">{feature.title}</h3>
                <p className="text-foreground leading-relaxed font-bold">{feature.description}</p>
              </div>
            );
          })}
        </div>

        {/* Robotics Platforms */}
        <div className="border-t-8 border-foreground pt-12">
          <h3 className="text-5xl font-black text-foreground mb-12 font-sans">
            SUPPORTED PLATFORMS
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'LEGO MINDSTORMS', type: 'EV3/Spike' },
              { name: 'ROSBOT', type: 'ROS2' },
              { name: 'ARDUINO', type: 'All Models' },
              { name: 'CUSTOM DRONES', type: 'Multi-rotor' },
            ].map((platform, i) => (
              <div key={i} className="p-8 bg-background border-4 border-foreground text-center">
                <Smartphone size={36} className="text-foreground mx-auto mb-4" />
                <p className="font-black text-foreground text-sm mb-1">{platform.name}</p>
                <p className="text-xs font-bold text-foreground">{platform.type}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
