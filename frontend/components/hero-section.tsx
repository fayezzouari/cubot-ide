'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Check } from 'lucide-react';
import { useNavigate } from '@/hooks/useNavigate';

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

/* The four workspace cubes, in the order the tagline names them. x and y are cube centres in scene units. */
const CUBES = [
  {
    name: 'Code IDE',
    image: '/jde-demo.png',
    kicker: 'ROS and embedded development',
    x: 943.4,
    y: 512,
    tint: 'text-ws-ide',
    text: 'A Monaco editor with an AI assistant beside it. Write ROS nodes or embedded C and C++, build them in the cloud and send them to hardware.',
    points: ['AI chat in Vibe or Plan mode', 'Arduino, TI ARM and ROS 2 builds', 'Serial monitor over WebSocket', 'Flash boards from the browser'],
  },
  {
    name: 'Block Builder',
    image: '/block-demo.png',
    kicker: 'Visual programming',
    x: 496.6,
    y: 512,
    tint: 'text-ws-blocks',
    text: 'Snap blocks together to drive a robot arm, no syntax needed. A live 3D view shows every move as the program runs.',
    points: ['Drag-and-drop node editor', 'Live 3D view of a 6-DOF arm', 'Motor, sensor and timing blocks', 'Auto-save with program history'],
  },
  {
    name: 'CAD Designer',
    image: '/cad-demo.png',
    kicker: 'AI 3D modeling',
    x: 720,
    y: 774,
    tint: 'text-ws-cad',
    text: 'Describe the part you need. CuBot plans the assembly, writes parametric CadQuery code and shows the model as it is built.',
    points: ['Plain language to 3D model', 'Multi-part assemblies', 'STL export for printing', 'Refine it in the chat'],
  },
  {
    name: 'Fleet Planner',
    image: '/fleet-demo.png',
    kicker: 'Multi-robot coordination',
    x: 720,
    y: 471,
    tint: 'text-ws-fleet',
    text: 'Draw a warehouse, add robots, drones and tasks, and let CuBot plan the paths and share out the work.',
    points: ['A*, Theta*, Dijkstra, RRT and RRT*', 'Deadline-aware task assignment', 'Simulated or live fleets over MQTT', 'Connect vehicles with cubot-sdk'],
  },
];

/* Camera stops: the overview, each cube, then back to the overview. */
const STOPS = [-1, ...CUBES.map((_, i) => i), -1];
const HOLD = 0.2;
const CUBE_SIZE = 100;
const TOURED = '(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/** Pins the hero while the reader scrolls and flies a camera to each workspace cube. */
function useCubeTour() {
  const [toured, setToured] = useState(false);
  const track = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const spotlight = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const query = window.matchMedia(TOURED);
    const sync = () => setToured(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const root = track.current;
    const rig = stage.current;
    const box = frame.current;
    const view = scene.current;
    const cam = camera.current;
    const light = spotlight.current;
    if (!toured || !root || !rig || !box || !view || !cam || !light) return;
    const labels = Array.from(view.querySelectorAll<HTMLElement>('[data-label]'));
    const fading = [copy.current].filter((el): el is HTMLDivElement => !!el);
    const panels = cards.current.filter((el): el is HTMLDivElement => !!el);

    const render = () => {
      const travel = root.offsetHeight - window.innerHeight;
      const progress = Math.min(Math.max(-root.getBoundingClientRect().top / travel, 0), 1);
      const at = progress * (STOPS.length - 1);
      const from = Math.min(Math.floor(at), STOPS.length - 2);
      const raw = Math.min(Math.max((at - from - HOLD) / (1 - 2 * HOLD), 0), 1);
      const t = ease(raw);
      const a = STOPS[from];
      const b = STOPS[from + 1];
      const flight = Math.sin(Math.PI * raw);

      const w = rig.offsetWidth;
      const h = rig.offsetHeight;
      const left = box.offsetLeft + view.offsetLeft;
      const top = box.offsetTop + view.offsetTop;
      const unit = view.offsetWidth / SCENE.width;
      const cube = CUBE_SIZE * unit;
      const target = { x: w * 0.2, y: h * 0.54 };
      const zoomed = Math.min((h * 0.28) / cube, 4);

      // Where the camera looks, in scene pixels, and where that point sits on screen.
      const shot = (stop: number) =>
        stop < 0
          ? { x: w / 2 - left, y: h / 2 - top, sx: w / 2, sy: h / 2, scale: 1 }
          : { x: CUBES[stop].x * unit, y: CUBES[stop].y * unit, sx: target.x, sy: target.y, scale: zoomed };
      const sa = shot(a);
      const sb = shot(b);
      const between = a >= 0 && b >= 0;

      // Between two cubes, pull back a little mid-flight and bank toward the next one.
      const scale = lerp(sa.scale, sb.scale, t) * (1 - (between ? 0.35 : 0) * flight);
      const x = lerp(sa.x, sb.x, t);
      const y = lerp(sa.y, sb.y, t);
      cam.style.transform = `translate(${lerp(sa.sx, sb.sx, t) - left - x * scale}px, ${lerp(sa.sy, sb.sy, t) - top - y * scale}px) scale(${scale})`;
      const ry = Math.max(Math.min(((sb.x - sa.x) / cube) * 4, 16), -16) * flight;
      const rx = Math.max(Math.min(((sa.y - sb.y) / cube) * 4, 12), -12) * flight;
      rig.style.transformOrigin = `${target.x}px ${target.y}px`;
      // Only tilt while moving: a flat transform keeps the art sharp once the camera stops.
      rig.style.transform = between && flight > 0.001 ? `perspective(1400px) rotateX(${rx}deg) rotateY(${ry}deg)` : '';

      const zoom = lerp(a < 0 ? 0 : 1, b < 0 ? 0 : 1, t);
      light.style.opacity = String(zoom);
      light.style.background = `radial-gradient(circle at ${target.x}px ${target.y}px, transparent ${h * 0.17}px, rgba(0,0,0,0.92) ${h * 0.42}px)`;
      fading.forEach((el) => {
        el.style.opacity = String(1 - zoom);
        el.style.visibility = zoom > 0.99 ? 'hidden' : '';
      });
      labels.forEach((el) => (el.style.opacity = String(1 - zoom)));
      panels.forEach((card, i) => {
        const shown = (a === i ? 1 - raw : 0) + (b === i ? raw : 0);
        const visible = Math.max(0, shown * 2 - 1);
        card.style.opacity = String(visible);
        card.style.transform = `translateY(calc(-50% + ${(1 - visible) * 20}px))`;
        card.style.visibility = visible > 0 ? 'visible' : 'hidden';
      });
    };

    render();
    window.addEventListener('scroll', render, { passive: true });
    window.addEventListener('resize', render);
    return () => {
      window.removeEventListener('scroll', render);
      window.removeEventListener('resize', render);
      cam.style.transform = '';
      rig.style.transform = '';
      fading.forEach((el) => {
        el.style.opacity = '';
        el.style.visibility = '';
      });
      labels.forEach((el) => (el.style.opacity = ''));
    };
  }, [toured]);

  return { toured, track, stage, frame, scene, camera, spotlight, copy, cards };
}

export default function HeroSection() {
  const navigate = useNavigate();
  const { toured, track, stage, frame, scene, camera, spotlight, copy, cards } = useCubeTour();

  return (
    <section ref={track} id="about" style={toured ? { height: `${100 + (STOPS.length - 1) * 85}vh` } : undefined}>
      <div className={toured ? 'sticky top-0 h-screen overflow-hidden' : 'relative overflow-hidden'}>
        <div ref={stage} className={toured ? 'relative h-full pt-28' : 'relative pt-28'}>
          <div ref={copy} className="hero-rise relative z-10 flex flex-col items-center px-6 text-center">
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

          <div
            ref={frame}
            className="relative left-1/2"
            style={{ width: 'clamp(760px, 100%, 1600px)', marginLeft: 'calc(clamp(760px, 100%, 1600px) / -2)' }}
          >
            <div ref={scene} className="relative -mt-[21.5%]" style={{ aspectRatio: `${SCENE.width} / ${SCENE.height}` }} aria-hidden="true">
              <div ref={camera} className="absolute inset-0 origin-top-left">
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
                    data-label
                    className={`hidden md:flex absolute items-center h-9 px-3 rounded-lg bg-surface border border-line text-sm font-semibold whitespace-nowrap ${shift} ${tint}`}
                    style={{ left: `${(x / SCENE.width) * 100}%`, top: `${(y / SCENE.height) * 100}%` }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {toured && (
          <>
            <div ref={spotlight} className="absolute inset-0 pointer-events-none opacity-0" aria-hidden="true" />
            {CUBES.map(({ name, image, kicker, text, points, tint }, i) => (
              <div
                key={name}
                ref={(el) => {
                  cards.current[i] = el;
                }}
                className="absolute left-[39%] top-[54%] w-[min(60rem,56%)] invisible opacity-0 rounded-2xl border border-line-strong bg-well/85 backdrop-blur-md p-5"
              >
                <div className="relative mb-4 aspect-[1438/840] overflow-hidden rounded-lg border border-line">
                  <Image src={image} alt={`The ${name} workspace`} fill sizes="(max-width: 1700px) 56vw, 960px" className="object-cover object-top" />
                </div>
                <p className="mb-3 flex items-center gap-3 font-mono text-xs text-ink-3 tabular-nums">
                  {String(i + 1).padStart(2, '0')} / {String(CUBES.length).padStart(2, '0')}
                  <span className={tint}>{kicker}</span>
                </p>
                <h2 className={`mb-2 text-2xl font-bold tracking-tight ${tint}`}>{name}</h2>
                <p className="mb-4 text-sm leading-relaxed text-ink-2">{text}</p>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-ink">
                      <Check size={15} className={`mt-0.5 shrink-0 ${tint}`} aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>

      <style>{`
        @keyframes heroRise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes heroOrbit {
          to { transform: rotate(360deg); }
        }

        .hero-rise {
          animation: heroRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .hero-orbit {
          transform-origin: 0 0;
          animation: heroOrbit linear infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-rise, .hero-orbit { animation: none; }
        }
      `}</style>
    </section>
  );
}
