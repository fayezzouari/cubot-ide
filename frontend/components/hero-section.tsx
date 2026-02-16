'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ASCIIText from '@/components/ui/ASCIIText';
import TextType from '@/components/TextType';
export default function HeroSection() {
  const router = useRouter();

  return (
    <section className="pt-24 pb-20 px-6 bg-background min-h-screen flex flex-col justify-center relative overflow-hidden">

      <div className="max-w-5xl mx-auto w-full relative z-10">

        {/* Main Heading */}
        <div className="mb-8 flex flex-col items-center justify-center">
          <div
            className="w-full mx-auto flex items-center justify-center relative rounded-xl bg-[rgba(20,20,20,0.04)]"
            style={{
              aspectRatio: '4/1',
              minHeight: '120px',
              maxWidth: '100vw',
            }}
          >
            <style>{`
              @media (min-width: 640px) {
                .ascii-hero {
                  min-height: 200px;
                  aspect-ratio: 4/1;
                }
              }
              @media (min-width: 1024px) {
                .ascii-hero {
                  min-height: 260px;
                  aspect-ratio: 5/1;
                }
              }
              @media (min-width: 1280px) {
                .ascii-hero {
                  min-height: 320px;
                  aspect-ratio: 6/1;
                }
              }
            `}</style>
            <div className="ascii-hero w-full h-full flex items-center justify-center">
            <ASCIIText
              text="CuBot"
              enableWaves={false}
              asciiFontSize={7}
            />
            </div>
          </div>
  <div className="mb-6">
    <TextType
      text={[
        "Learn robotics with ease.",
        "Build your next project.",
        "Deploy code to real hardware.",
        "Learn, Build, Deploy.",
        "Build and deploy with AI.",
        "Deploy your ideas into reality.",
        "Learn new skills every day.",
        "Build smarter, not harder.",
        "Deploy with confidence."
      ]}
      typingSpeed={10}
      pauseDuration={1500}
      showCursor
      cursorCharacter="_"
      deletingSpeed={10}
      cursorBlinkDuration={0.5}
    />
  </div>

        {/* Description & CTA Centered */}
<div className="flex flex-col items-center justify-center">
  <p className="text-base md:text-lg text-muted-foreground max-w-2xl mb-6 leading-relaxed text-center">
    Master microcontrollers and embedded systems with AI-powered code editing and no-code robot programming. Compile, simulate, and test on virtual boards before deploying to real hardware.
  </p>

  <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
    <Button
      onClick={() => router.push('/dashboard')}
      size="lg"
      className="px-8 h-12 font-medium text-base cursor-pointer flex items-center gap-2 transition-transform transition-shadow transition-colors duration-200 hover:scale-105 hover:shadow-lg hover:bg-white hover:text-black"
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
      </div>
      </div>
      </section>
  );
}
