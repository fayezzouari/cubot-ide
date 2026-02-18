'use client';

import { ArrowRight } from 'lucide-react';
import ASCIIText from '@/components/ui/ASCIIText';
import TextType from '@/components/TextType';
import { useNavigate } from '@/hooks/useNavigate';

export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="min-h-screen flex flex-col justify-center pt-14 pb-16 px-6 relative overflow-hidden">
      {/* Subtle dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="max-w-5xl mx-auto w-full relative z-10">
        {/* Badge */}
        <div className="flex justify-center mb-8">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border text-xs text-muted-foreground font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Open Source Embedded IDE
          </span>
        </div>

        {/* ASCII Title */}
        <div
          className="w-full mx-auto mb-4 pointer-events-none"
          style={{ aspectRatio: '5/1', minHeight: '120px' }}
        >
          <style>{`
            @media (min-width: 640px) { .ascii-hero { min-height: 160px; } }
            @media (min-width: 1024px) { .ascii-hero { min-height: 220px; } }
            @media (min-width: 1280px) { .ascii-hero { min-height: 270px; } }
          `}</style>
          <div className="ascii-hero w-full h-full flex items-center justify-center">
            <ASCIIText
              text="CuBot"
              enableWaves={false}
              asciiFontSize={7}
            />
          </div>
        </div>

        {/* Typing tagline */}
        <div className="flex justify-center mb-6">
          <TextType
            text={[
              "Write embedded software with AI.",
              "Simulate on virtual microcontrollers.",
              "Deploy to real hardware.",
              "Learn, Build, Deploy.",
            ]}
            typingSpeed={12}
            pauseDuration={2000}
            showCursor
            cursorCharacter="_"
            deletingSpeed={8}
            cursorBlinkDuration={0.5}
          />
        </div>

        {/* Description */}
        <p className="text-center text-sm md:text-base text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
          AI-powered code editor and no-code block builder for embedded systems.
          Compile, simulate, and test on virtual boards — then deploy to real hardware.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-12">
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded-md transition-all hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] cursor-pointer"
          >
            Start Building
            <ArrowRight size={15} />
          </button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 border border-border hover:border-foreground/30 text-foreground font-medium text-sm rounded-md transition-colors"
          >
            View on GitHub
          </a>
        </div>

        {/* Stats strip */}
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground font-mono">
          <span>4 MCU targets</span>
          <span className="text-border">·</span>
          <span>AI-powered</span>
          <span className="text-border">·</span>
          <span>Open source</span>
          <span className="text-border">·</span>
          <span>No hardware needed</span>
        </div>
      </div>
    </section>
  );
}
