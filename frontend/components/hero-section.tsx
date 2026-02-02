'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Cpu, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import WorkspaceModal from '@/components/workspace-modal';

export default function HeroSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <section className="pt-32 pb-20 px-6 bg-background min-h-screen flex flex-col justify-center">
      <div className="max-w-5xl mx-auto w-full">
        {/* Tagline */}
        <div className="mb-8 border-l-8 border-foreground pl-6">
          <p className="text-sm font-black text-foreground tracking-widest">LEARN. BUILD. DEPLOY.</p>
        </div>

        {/* Main Heading */}
        <h1 className="text-7xl md:text-8xl font-black text-foreground mb-12 leading-none font-sans">
          EMBEDDED<br />ROBOTICS<br /><span className="border-4 border-foreground px-4 py-2 inline-block mt-4">SIMPLIFIED</span>
        </h1>

        {/* Description */}
        <p className="text-base md:text-lg text-foreground max-w-3xl mb-16 leading-relaxed font-sans font-bold">
          Master microcontrollers and embedded systems with AI-powered code editing and no-code robot programming. Compile, simulate, and test on virtual boards before deploying to real hardware.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-6 items-start">
            <Button
              onClick={() => setIsModalOpen(true)}
              className="px-8 py-4 bg-primary border-4 border-foreground text-primary-foreground font-black text-base cursor-pointer hover:bg-muted hover:text-black transition-all flex items-center"
            >
              START BUILDING
              <ArrowRight size={20} className="ml-2" />
            </Button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 border-4 border-foreground text-foreground font-black text-base hover:bg-foreground hover:text-background transition-all"
          >
            VIEW ON GITHUB
          </a>
        </div>

        {/* Workspace Selection Modal */}
        <WorkspaceModal open={isModalOpen} onOpenChange={setIsModalOpen} />
      </div>

      {/* Raw Code Preview Box */}
      <div className="mt-24 max-w-5xl mx-auto w-full">
        <div className="border-4 border-foreground bg-muted p-8">
          <div className="flex items-center gap-3 mb-6 pb-6 border-b-4 border-foreground">
            <Cpu size={28} className="text-foreground" />
            <p className="font-black text-foreground text-lg">VIRTUAL MICROCONTROLLER</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border-2 border-foreground p-4 text-center">
              <p className="font-black text-foreground text-sm">GPIO</p>
            </div>
            <div className="border-2 border-foreground p-4 text-center">
              <p className="font-black text-foreground text-sm">ADC</p>
            </div>
            <div className="border-2 border-foreground p-4 text-center">
              <p className="font-black text-foreground text-sm">PWM</p>
            </div>
            <div className="border-2 border-foreground p-4 text-center">
              <p className="font-black text-foreground text-sm">UART</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
