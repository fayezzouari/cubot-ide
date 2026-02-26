'use client';

import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import ASCIIText from '@/components/ui/ASCIIText';
import TextType from '@/components/TextType';
import { useNavigate } from '@/hooks/useNavigate';

const TICKER = [
  'Arduino Uno', 'ESP32', 'STM32', 'AI Code Generation',
  'Visual Block Programming', 'AI CAD Designer', 'MCU Simulator',
  'Monaco Editor', 'No Hardware Required', 'Open Source',
  'C / C++', 'Browser-Based',
];

export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="min-h-screen flex flex-col justify-center pt-20 pb-0 relative overflow-hidden">

      {/* Ambient glow centred behind the ASCII */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '15%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '900px',
          height: '500px',
          background:
            'radial-gradient(ellipse at center, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.03) 45%, transparent 70%)',
          filter: 'blur(10px)',
        }}
        aria-hidden="true"
      />

      {/* ── Top meta row ── */}
      <div
        className="hi flex items-center justify-center gap-3 mb-10 px-6"
        style={{ '--d': '0ms' } as React.CSSProperties}
      >
        <Image src="/cubot.svg" alt="CuBot" width={22} height={22} className="opacity-50" />
        <span className="w-px h-3.5 bg-white/10" />
        <span className="text-[10px] font-mono text-white/25 tracking-[0.22em] uppercase select-none">
          Embedded Systems IDE
        </span>
        <span className="w-px h-3.5 bg-white/10" />
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-1 h-1 rounded-full bg-blue-400"
            style={{ boxShadow: '0 0 5px rgba(96,165,250,0.9)', animation: 'hPulse 2s ease-in-out infinite' }}
          />
          <span className="text-[10px] font-mono text-blue-400/60 tracking-widest uppercase">Open Beta</span>
        </span>
      </div>

      {/* ── MASSIVE ASCII title ── */}
      <div
        className="hi pointer-events-none relative w-full"
        style={{ height: '420px', '--d': '60ms' } as React.CSSProperties}
      >
        <ASCIIText
          text="CuBot"
          enableWaves={false}
          asciiFontSize={7}
          textFontSize={310}
          planeBaseHeight={13}
        />
      </div>

      {/* ── Tagline sits just below the ASCII ── */}
      <div
        className="hi h-7 flex items-center justify-center mt-1 mb-0 px-6"
        style={{ '--d': '140ms' } as React.CSSProperties}
      >
        <TextType
          text={[
            "Write embedded C/C++ with AI.",
            "Compile for Arduino, ESP32 & STM32.",
            "Simulate on virtual microcontrollers.",
            "Design 3D parts with conversational AI.",
            "Control robots with visual block code.",
          ]}
          typingSpeed={12}
          pauseDuration={2200}
          showCursor
          cursorCharacter="_"
          deletingSpeed={8}
          cursorBlinkDuration={0.5}
        />
      </div>

      {/* ── Full-width divider ── */}
      <div
        className="hi w-full mt-10 mb-0"
        style={{ '--d': '200ms' } as React.CSSProperties}
      >
        <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
      </div>

      {/* ── Centre belt ── */}
      <div
        className="hi flex flex-col items-center gap-6 px-6 py-10"
        style={{ '--d': '270ms' } as React.CSSProperties}
      >
        {/* Description */}
        <p className="text-[13px] text-white/35 leading-relaxed text-center max-w-md">
          A browser-based IDE combining a professional code editor, visual block builder, and
          AI-powered CAD designer — built for embedded systems and robotics.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
          <button
            onClick={() => navigate('/dashboard')}
            className="group w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-black font-semibold text-sm rounded-xl cursor-pointer transition-all duration-200"
            style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.12), 0 0 36px rgba(255,255,255,0.07)' }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.22), 0 0 52px rgba(255,255,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.12), 0 0 36px rgba(255,255,255,0.07)')}
          >
            Start Building
            <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-white/[0.08] hover:border-white/[0.16] hover:bg-white/[0.03] text-white/35 hover:text-white/60 font-medium text-sm rounded-xl transition-all duration-200"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current shrink-0" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            View on GitHub
          </a>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {[
            { value: '3',  label: 'Workspaces' },
            { value: '4',  label: 'MCU Targets' },
            { value: '∞', label: 'Projects' },
            { value: 'AI', label: 'Powered' },
          ].map((s, i, arr) => (
            <span key={s.label} className="flex items-center">
              <span className="flex items-baseline gap-1.5 px-3">
                <span className="font-mono text-sm font-semibold text-white/50">{s.value}</span>
                <span className="text-[11px] text-white/22 font-mono">{s.label}</span>
              </span>
              {i < arr.length - 1 && <span className="text-white/[0.08] font-mono select-none">·</span>}
            </span>
          ))}
        </div>
      </div>

      {/* ── Bottom divider ── */}
      <div className="w-full">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
      </div>

      {/* ── Infinite ticker ── */}
      <div className="ticker-wrap py-4">
        <div className="ticker-track">
          {[...TICKER, ...TICKER, ...TICKER].map((item, i) => (
            <span key={i} className="ticker-item">
              {item}
              <span className="ticker-sep">·</span>
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes hFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes hPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
        @keyframes hTicker {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.333%); }
        }

        .hi {
          opacity: 0;
          animation: hFadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: var(--d, 0ms);
        }

        .ticker-wrap {
          overflow: hidden;
          mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
        }
        .ticker-track {
          display: flex;
          width: max-content;
          animation: hTicker 28s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
        .ticker-item {
          display: inline-flex;
          align-items: center;
          font-size: 10.5px;
          font-family: monospace;
          color: rgba(255,255,255,0.18);
          white-space: nowrap;
          padding: 0 6px;
          letter-spacing: 0.04em;
          cursor: default;
          transition: color 0.2s;
        }
        .ticker-item:hover {
          color: rgba(255,255,255,0.45);
        }
        .ticker-sep {
          margin-left: 14px;
          color: rgba(255,255,255,0.07);
        }
      `}</style>
    </section>
  );
}
