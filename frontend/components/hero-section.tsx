'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HeroSection() {
  const router = useRouter();

  return (
    <section className="pt-24 pb-20 px-6 bg-background min-h-screen flex flex-col justify-center">
      <div className="max-w-5xl mx-auto w-full">
        {/* Tagline */}
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-12 bg-primary" />
          <p className="text-sm font-medium text-primary uppercase tracking-wider">Learn. Build. Deploy.</p>
        </div>

        {/* Main Heading */}
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-8 leading-tight">
          Embedded Robotics<br />
          <span className="text-primary">Simplified</span>
        </h1>

        {/* Description */}
        <p className="text-base md:text-lg text-muted-foreground max-w-2xl mb-12 leading-relaxed">
          Master microcontrollers and embedded systems with AI-powered code editing and no-code robot programming. Compile, simulate, and test on virtual boards before deploying to real hardware.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <Button
            onClick={() => router.push('/dashboard')}
            size="lg"
            className="px-8 h-12 font-medium text-base cursor-pointer flex items-center gap-2"
          >
            Start Building
            <ArrowRight size={18} />
          </Button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-8 h-12 border border-border text-foreground font-medium text-base hover:bg-muted rounded transition-colors cursor-pointer"
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* Feature Preview Box */}
      <div className="mt-20 max-w-5xl mx-auto w-full">
        <div className="border border-border bg-card rounded-lg p-8">
          <div className="flex items-center gap-3 mb-6 pb-6 border-b border-border">
            <div className="p-2 bg-primary/10 rounded">
              <Cpu size={24} className="text-primary" />
            </div>
            <p className="font-semibold text-foreground text-base">Virtual Microcontroller</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border border-border rounded p-4 text-center hover:border-primary/50 transition-colors">
              <p className="font-medium text-foreground text-sm">GPIO</p>
            </div>
            <div className="border border-border rounded p-4 text-center hover:border-primary/50 transition-colors">
              <p className="font-medium text-foreground text-sm">ADC</p>
            </div>
            <div className="border border-border rounded p-4 text-center hover:border-primary/50 transition-colors">
              <p className="font-medium text-foreground text-sm">PWM</p>
            </div>
            <div className="border border-border rounded p-4 text-center hover:border-primary/50 transition-colors">
              <p className="font-medium text-foreground text-sm">UART</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
