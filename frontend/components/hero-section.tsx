'use client';

import { ArrowRight } from 'lucide-react';
import { useNavigate } from '@/hooks/useNavigate';

const TICKER = [
  'Arduino Uno', 'ESP32', 'STM32', 'AI Code Generation',
  'Visual Block Programming', 'AI CAD Designer', 'MCU Simulator',
  'Monaco Editor', 'No Hardware Required', 'Open Source',
  'C / C++', 'Browser-Based',
];

const SCENE = { width: 1440, height: 900 };

const LABELS = [
  { name: 'Block Builder', x: 435, y: 425, shift: '-translate-x-full -translate-y-full', tint: 'text-ws-blocks' },
  { name: 'Code IDE', x: 1005, y: 425, shift: '-translate-y-full', tint: 'text-ws-ide' },
  { name: 'Fleet Planner', x: 829, y: 407, shift: '-translate-x-1/3 -translate-y-full', tint: 'text-ws-fleet' },
  { name: 'CAD Designer', x: 836, y: 826, shift: '-translate-y-1/2', tint: 'text-ws-cad' },
];

const TICKS = Array.from({ length: 72 }, (_, i) => {
  const angle = (i * 5 * Math.PI) / 180;
  const outer = i % 3 === 0 ? 8.3 : 7.95;
  return {
    x1: +(7.6 * Math.cos(angle)).toFixed(3),
    y1: +(7.6 * Math.sin(angle)).toFixed(3),
    x2: +(outer * Math.cos(angle)).toFixed(3),
    y2: +(outer * Math.sin(angle)).toFixed(3),
  };
});

const SPOKES = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * 45 * Math.PI) / 180;
  return {
    x1: +(3.4 * Math.cos(angle)).toFixed(3),
    y1: +(3.4 * Math.sin(angle)).toFixed(3),
    x2: +(10.2 * Math.cos(angle)).toFixed(3),
    y2: +(10.2 * Math.sin(angle)).toFixed(3),
  };
});

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2';

export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden pt-28">
      <div className="hero-rise relative z-10 flex flex-col items-center px-6 text-center">
        <h1>
          <span className="block text-xl sm:text-2xl lg:text-3xl text-ink-3 tracking-tight">
            Code, blocks, CAD and fleets
          </span>
          <span className="block mt-1 pb-2 text-5xl sm:text-7xl lg:text-[84px] font-bold tracking-[-0.05em] leading-[1.05] bg-gradient-to-b from-white from-25% to-ink-3 bg-clip-text text-transparent">
            light up one robot.
          </span>
        </h1>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
          <button
            onClick={() => navigate('/dashboard')}
            className={`group inline-flex items-center justify-center gap-2 px-6 h-[52px] bg-ink hover:bg-white text-well font-semibold text-base rounded-lg cursor-pointer transition-colors ${focusRing}`}
          >
            Start building
            <ArrowRight size={15} strokeWidth={2.4} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <a
            href="https://github.com/fayezzouari/cubot-ide"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-2 px-6 h-[52px] border border-line-strong hover:border-ink-3 bg-well hover:bg-surface text-ink font-medium text-base rounded-lg transition-colors ${focusRing}`}
          >
            View on GitHub
          </a>
        </div>
      </div>

      <div className="relative left-1/2 -translate-x-1/2" style={{ width: 'clamp(760px, 100%, 1600px)' }}>
        <div className="relative -mt-[21.5%]" style={{ aspectRatio: `${SCENE.width} / ${SCENE.height}` }} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/hero-back.svg" alt="" className="absolute inset-0 w-full h-full" />

          <svg viewBox={`0 0 ${SCENE.width} ${SCENE.height}`} className="absolute inset-0 w-full h-full" fill="none">
            <g transform="matrix(43.3 25 -43.3 25 720 709.5)">
              <circle r="10.2" stroke="#161616" vectorEffect="non-scaling-stroke" />
              {SPOKES.map((s, i) => (
                <line key={i} {...s} stroke="#141414" vectorEffect="non-scaling-stroke" />
              ))}
              <g className="hero-orbit" style={{ animationDuration: '90s' }}>
                <circle r="7.6" stroke="#1C1C1C" vectorEffect="non-scaling-stroke" />
                {TICKS.map((t, i) => (
                  <line key={i} {...t} stroke="#2C2C2C" vectorEffect="non-scaling-stroke" />
                ))}
                <circle cx="7.6" cy="0" r="0.3" fill="#FFFFFF" opacity="0.14" />
                <circle cx="7.6" cy="0" r="0.11" fill="#EDEDED" />
              </g>
              <g className="hero-orbit" style={{ animationDuration: '38s', animationDirection: 'reverse' }}>
                <circle r="5.4" stroke="#242424" strokeDasharray="2 7" vectorEffect="non-scaling-stroke" />
                <circle cx="0" cy="5.4" r="0.26" fill="#FFFFFF" opacity="0.14" />
                <circle cx="0" cy="5.4" r="0.09" fill="#EDEDED" />
              </g>
              <g className="hero-orbit" style={{ animationDuration: '24s' }}>
                <circle r="3.4" stroke="#222222" vectorEffect="non-scaling-stroke" />
                <circle cx="-3.4" cy="0" r="0.22" fill="#FFFFFF" opacity="0.14" />
                <circle cx="-3.4" cy="0" r="0.08" fill="#EDEDED" />
              </g>
            </g>
          </svg>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/hero-front.svg" alt="" className="absolute inset-0 w-full h-full" />

          {LABELS.map(({ name, x, y, shift, tint }) => (
            <span
              key={name}
              className={`hidden md:flex absolute items-center h-9 px-3 rounded-lg bg-surface border border-line text-sm font-semibold whitespace-nowrap ${shift} ${tint}`}
              style={{ left: `${(x / SCENE.width) * 100}%`, top: `${(y / SCENE.height) * 100}%` }}
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="ticker-wrap relative z-10 py-4 border-y border-line">
        <div className="ticker-track">
          {[...TICKER, ...TICKER, ...TICKER].map((item, i) => (
            <span key={i} className="ticker-item">
              {item}
              <span className="ticker-sep">/</span>
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes heroRise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes heroOrbit {
          to { transform: rotate(360deg); }
        }
        @keyframes heroTicker {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.333%); }
        }

        .hero-rise {
          animation: heroRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .hero-orbit {
          transform-origin: 0 0;
          animation: heroOrbit linear infinite;
        }

        .ticker-wrap {
          overflow: hidden;
          mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
        }
        .ticker-track {
          display: flex;
          width: max-content;
          animation: heroTicker 28s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
        .ticker-item {
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          color: #878787;
          white-space: nowrap;
          padding: 0 6px;
          cursor: default;
          transition: color 0.2s;
        }
        .ticker-item:hover {
          color: #ededed;
        }
        .ticker-sep {
          margin-left: 14px;
          color: #404040;
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-rise, .hero-orbit, .ticker-track { animation: none; }
        }
      `}</style>
    </section>
  );
}
