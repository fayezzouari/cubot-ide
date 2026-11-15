'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { useStopProgress } from '@/components/section-journey';
import { ArrowUpRight, BrainCircuit, Check, Cloud, Container, Cpu, Github, Globe, Route, Server, type LucideIcon } from 'lucide-react';

const REPO = 'https://github.com/fayezzouari/cubot-ide';

const AVAILABLE = ['Arduino Uno', 'TI ARM Cortex-M', 'ROS 2 Humble'];
const SOON = ['ESP32', 'STM32F4', 'STM32L476'];

const tile = 'rounded-2xl border border-line bg-surface p-5 flex flex-col';
const stage = 'rounded-xl border border-line bg-well';

function Copy({ icon: Icon, title, line, tint }: { icon: LucideIcon; title: string; line: string; tint: string }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2">
        <Icon size={16} className={tint} aria-hidden="true" />
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>
      <p className="text-sm text-ink-2 leading-relaxed">{line}</p>
    </div>
  );
}

function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden="true" className={`${stage} h-36 mb-5 overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

/* AI: a Plan-mode answer with a diff to accept, drawn in HTML so it stays sharp. */
function ChatMock() {
  return (
    <div aria-hidden="true" className={`${stage} p-4 text-[13px]`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-ink-2 font-medium">AI Assistant</span>
        <span className="flex rounded-md border border-line p-0.5 text-xs">
          <span className="px-2 py-0.5 text-ink-3">Vibe</span>
          <span className="px-2 py-0.5 rounded bg-raised text-ink">Plan</span>
        </span>
      </div>

      <p className="ml-auto w-fit max-w-[85%] mb-3 rounded-lg rounded-br-sm bg-raised px-3 py-2 text-ink">
        Blink the LED on pin 13 every 500 ms
      </p>

      <ol className="space-y-1.5 mb-3 text-ink-2">
        {['Set pin 13 as an output', 'Toggle it in loop()'].map((step) => (
          <li key={step} className="flex items-center gap-2">
            <Check size={13} className="text-ws-cad" />
            {step}
          </li>
        ))}
      </ol>

      <pre className="mb-3 rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs leading-5 text-ok">
{`+ pinMode(13, OUTPUT);
+ digitalWrite(13, !digitalRead(13));
+ delay(500);`}
      </pre>

      <div className="flex gap-2 text-xs font-medium">
        <span className="rounded-md bg-ink px-3 py-1 text-page">Accept</span>
        <span className="rounded-md border border-line-strong px-3 py-1 text-ink-2">Discard</span>
      </div>
    </div>
  );
}

const RUNS_ON: [LucideIcon, string, string][] = [
  [Container, 'Compilers', 'Docker'],
  [Server, 'ROS 2', 'Cloud sandbox'],
  [Globe, 'MCU simulator', 'Your browser'],
];

function RunsOnMock() {
  return (
    <ul className="h-full flex flex-col justify-center gap-2 px-4">
      {RUNS_ON.map(([Icon, what, where]) => (
        <li key={what} className="flex items-center gap-3 rounded-lg bg-surface border border-line px-3 py-1.5 text-sm">
          <Icon size={14} className="text-ws-ide" />
          <span className="text-ink-2">{what}</span>
          <span className="ml-auto text-ink">{where}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-ok" />
        </li>
      ))}
    </ul>
  );
}

function PinsMock() {
  const pins = ['D8', 'D9', 'D10', 'D11', 'D12', 'D13'];
  return (
    <div className="h-full flex flex-col justify-center gap-4 px-4">
      <div className="flex justify-between">
        {pins.map((pin) => {
          const on = pin === 'D13' || pin === 'D9';
          return (
            <div key={pin} className="flex flex-col items-center gap-1.5">
              <span
                className={`w-4 h-4 rounded-full border ${on ? 'bg-ws-blocks border-ws-blocks shadow-[0_0_12px_2px] shadow-ws-blocks/60' : 'border-line-strong'}`}
              />
              <span className="font-mono text-[11px] text-ink-3">{pin}</span>
            </div>
          );
        })}
      </div>
      <p className="rounded-md bg-surface border border-line px-3 py-1.5 font-mono text-xs text-ink-2">
        <span className="text-ink-3">UART ›</span> LED on, A0 = 512
      </p>
    </div>
  );
}

function RouteMock() {
  return (
    <svg
      viewBox="0 0 240 120"
      className="w-full h-full text-ws-fleet"
      style={{
        backgroundImage:
          'linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)',
        backgroundSize: '14px 14px',
      }}
    >
      {[[36, 24], [132, 24], [36, 72], [132, 72]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="72" height="16" rx="2" fill="var(--color-raised)" stroke="var(--color-line-strong)" />
      ))}
      <path d="M20 108 V56 H120 V8 H214 V50" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx="20" cy="108" r="6" fill="currentColor" />
      <rect x="208" y="44" width="12" height="12" transform="rotate(45 214 50)" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text x="30" y="104" fontSize="9" fill="var(--color-ink-2)" fontFamily="monospace">AMR-01</text>
    </svg>
  );
}

function CloneMock() {
  return (
    <div className="h-full flex flex-col justify-center gap-2 px-4 font-mono text-xs">
      <p className="text-ink-2">
        <span className="text-ok">$</span> git clone github.com/fayezzouari/cubot-ide
      </p>
      <p className="text-ink-2">
        <span className="text-ok">$</span> docker compose up
      </p>
      <p className="text-ink-3">✓ CuBot running on localhost:3000</p>
    </div>
  );
}

/* What the camera says about each tile once it has zoomed in. */
const TOUR: { title: string; text: string; points: string[]; below?: boolean }[] = [
  {
    title: 'AI in every workspace',
    text: 'Ask in Vibe mode for a quick edit, or switch to Plan mode: Claude lists the steps, writes the diff, and nothing changes until you accept it.',
    points: ['Vibe and Plan modes', 'Accept or discard every diff', 'Plans CAD assemblies', 'Explains build errors'],
    below: true,
  },
  {
    title: 'Nothing to install',
    text: 'Open a project and start working. Compilers run in Docker, ROS 2 runs in a sandbox with its own terminal, and the simulator runs in your tab.',
    points: ['Arduino and TI ARM toolchains', 'ROS 2 Humble sandboxes', 'Live build logs'],
  },
  {
    title: 'Test without hardware',
    text: 'Your compiled firmware runs on a virtual ATmega328P. Watch the pins toggle and read the serial output before you plug anything in.',
    points: ['GPIO, ADC, PWM, UART', 'Serial monitor', 'Flash a real board over USB'],
  },
  {
    title: 'Speaks VDA 5050',
    text: 'Draw the warehouse, place robots, drones and tasks. CuBot plans the paths, assigns the work by deadline and drives the fleet.',
    points: ['A*, Theta*, Dijkstra, RRT, RRT*', 'Deadline-aware task assignment', 'Real vehicles over MQTT'],
  },
  {
    title: 'Free and open source',
    text: 'Clone the repository, run Docker Compose and you have your own CuBot. Issues and pull requests are welcome.',
    points: ['Self-host with Docker Compose', 'Every workspace included'],
  },
  {
    title: 'Supported hardware',
    text: 'Arduino Uno, TI ARM Cortex-M boards and ROS 2 Humble work today. ESP32 and STM32 boards are next.',
    points: ['Compile in the cloud', 'Flash from the browser'],
    below: true,
  },
];

/* The camera stops on the overview, each tile in turn, then the overview again. */
const STOPS = [-1, ...TOUR.map((_, i) => i), -1];
const HOLD = 0.2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

type Shot = { x: number; y: number; cx: number; cy: number; scale: number };

/** Flies a camera over the tiles while the journey holds on this section. */
function useCamera() {
  const { staged, progress } = useStopProgress();
  const viewport = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = viewport.current;
    const cam = camera.current;
    const map = world.current;
    if (!staged || !progress || !view || !cam || !map) return;

    const tiles = Array.from(map.querySelectorAll<HTMLElement>('[data-tile]'));
    const intro = map.querySelector<HTMLElement>('[data-intro]');
    const captions = Array.from(view.querySelectorAll<HTMLElement>('[data-caption]'));

    // Where the camera looks (x, y in the grid) and where that point lands on screen (cx, cy).
    const shot = (stop: number): Shot => {
      const w = view.offsetWidth;
      const h = view.offsetHeight;
      if (stop < 0) return { x: w / 2, y: h / 2, cx: w / 2, cy: h / 2, scale: 1 };
      const tile = tiles[stop];
      const x = tile.offsetLeft + tile.offsetWidth / 2;
      const y = tile.offsetTop + tile.offsetHeight / 2;
      if (TOUR[stop].below) {
        // Sit the tile just above its caption, which starts at 60% of the height.
        const scale = Math.max(Math.min((w * 0.9) / tile.offsetWidth, (h * 0.5) / tile.offsetHeight, 2.4), 1);
        return { x, y, cx: w / 2, cy: h * 0.6 - 24 - (tile.offsetHeight * scale) / 2, scale };
      }
      const scale = Math.max(Math.min((w * 0.52) / tile.offsetWidth, (h * 0.82) / tile.offsetHeight, 2.4), 1);
      return { x, y, cx: w * 0.3, cy: h / 2, scale };
    };

    const render = (value: number) => {
      const at = value * (STOPS.length - 1);
      const from = Math.min(Math.floor(at), STOPS.length - 2);
      const raw = Math.min(Math.max((at - from - HOLD) / (1 - 2 * HOLD), 0), 1);
      const t = ease(raw);
      const a = STOPS[from];
      const b = STOPS[from + 1];
      const sa = shot(a);
      const sb = shot(b);
      const flight = Math.sin(Math.PI * raw);

      // Pull back a little mid-flight and bank toward where the camera is heading.
      const scale = lerp(sa.scale, sb.scale, t) * (1 - (a >= 0 && b >= 0 ? 0.22 : 0.08) * flight);
      const x = lerp(sa.x, sb.x, t);
      const y = lerp(sa.y, sb.y, t);
      const w = view.offsetWidth || 1;
      const h = view.offsetHeight || 1;
      const ry = Math.max(Math.min(((sb.x - sa.x) / w) * 40, 14), -14) * flight;
      const rx = Math.max(Math.min(((sa.y - sb.y) / h) * 30, 12), -12) * flight;
      map.style.transform = `translate(${lerp(sa.cx, sb.cx, t) - x * scale}px, ${lerp(sa.cy, sb.cy, t) - y * scale}px) scale(${scale})`;
      // Only tilt while moving: a flat transform keeps text sharp once the camera stops.
      cam.style.transform = flight > 0.001 ? `perspective(1400px) rotateX(${rx}deg) rotateY(${ry}deg)` : '';

      const focus = (stop: number, i: number) => (stop < 0 || stop === i ? 1 : 0.1);
      tiles.forEach((tile, i) => {
        tile.style.opacity = String(lerp(focus(a, i), focus(b, i), t));
      });
      if (intro) intro.style.opacity = String(lerp(a < 0 ? 1 : 0.1, b < 0 ? 1 : 0.1, t));
      captions.forEach((caption, i) => {
        const shown = (a === i ? 1 - raw : 0) + (b === i ? raw : 0);
        const visible = Math.max(0, shown * 2 - 1);
        caption.style.opacity = String(visible);
        caption.style.transform = `translateY(${(1 - visible) * 16}px)`;
        caption.style.visibility = visible > 0 ? 'visible' : 'hidden';
      });
    };

    const unsubscribe = progress.subscribe(render);
    const observer = new ResizeObserver(() => render(progress.value));
    observer.observe(view);
    return () => {
      unsubscribe();
      observer.disconnect();
      map.style.transform = '';
      cam.style.transform = '';
      tiles.forEach((tile) => (tile.style.opacity = ''));
      if (intro) intro.style.opacity = '';
    };
  }, [staged, progress]);

  return { staged, viewport, camera, world };
}

function Caption({ index }: { index: number }) {
  const { title, text, points, below } = TOUR[index];
  return (
    <div
      data-caption
      className={`absolute pointer-events-none invisible opacity-0 rounded-2xl border border-line-strong bg-well/90 backdrop-blur-md p-6 ${
        below ? 'left-1/2 top-[60%] -ml-[min(24rem,45%)] w-[min(48rem,90%)]' : 'right-0 top-1/2 -mt-36 w-[36%] min-h-72'
      }`}
    >
      <p className="mb-3 font-mono text-xs text-ink-3 tabular-nums">
        {String(index + 1).padStart(2, '0')} / {String(TOUR.length).padStart(2, '0')}
      </p>
      <h3 className="mb-3 text-2xl font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mb-5 text-base leading-relaxed text-ink-2">{text}</p>
      <ul className={below ? 'flex flex-wrap gap-x-5 gap-y-2' : 'space-y-2'}>
        {points.map((point) => (
          <li key={point} className="flex items-center gap-2 text-sm text-ink-2">
            <Check size={14} className="shrink-0 text-ok" aria-hidden="true" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FeaturesSection() {
  const { staged, viewport, camera, world } = useCamera();

  return (
    <section id="features" className="py-24 px-6">
      <div ref={viewport} className={`max-w-6xl mx-auto relative ${staged ? 'overflow-hidden' : ''}`}>
        <div ref={camera} className="origin-center">
          <div ref={world} className="relative origin-top-left">
            <div data-intro className="mb-10 max-w-2xl">
              <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
                Built for the full development loop.
              </h2>
              <p className="text-base text-ink-2 leading-relaxed">
                What every workspace shares, so a project never has to leave the browser.
                {staged && <span className="text-ink-3"> Keep scrolling for a closer look.</span>}
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div data-tile className={`${tile} md:col-span-2 lg:flex-row lg:items-center gap-6`}>
                <div className="lg:w-[42%] flex flex-col gap-5">
                  <Copy
                    icon={BrainCircuit}
                    title="AI in every workspace"
                    line="Claude plans changes, writes the code and waits for your OK. It also builds CAD parts and explains build errors."
                    tint="text-ws-cad"
                  />
                </div>
                <div className="flex-1">
                  <ChatMock />
                </div>
              </div>

              <div data-tile className={tile}>
                <Stage>
                  <RunsOnMock />
                </Stage>
                <Copy icon={Cloud} title="Nothing to install" line="A browser is all you need. Everything heavy runs for you." tint="text-ws-ide" />
              </div>

              <div data-tile className={tile}>
                <Stage>
                  <PinsMock />
                </Stage>
                <Copy
                  icon={Cpu}
                  title="Test without hardware"
                  line="A virtual ATmega328P runs your firmware, with GPIO, ADC, PWM and UART."
                  tint="text-ws-blocks"
                />
              </div>

              <div data-tile className={tile}>
                <Stage>
                  <RouteMock />
                </Stage>
                <Copy
                  icon={Route}
                  title="Speaks VDA 5050"
                  line="Plan with A*, Theta* or RRT*, then drive simulated or real vehicles over MQTT."
                  tint="text-ws-fleet"
                />
              </div>

              <a
                data-tile
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className={`${tile} group hover:border-line-strong transition-colors`}
              >
                <Stage>
                  <CloneMock />
                </Stage>
                <div className="flex items-start gap-2">
                  <Copy icon={Github} title="Free and open source" line="Read the code, host it yourself, or send a pull request." tint="text-ink" />
                  <ArrowUpRight size={16} className="ml-auto shrink-0 text-ink-3 group-hover:text-ink transition-colors" />
                </div>
              </a>

              <div data-tile className={`${tile} md:col-span-2 lg:col-span-3 lg:flex-row lg:items-center gap-4 lg:gap-8`}>
                <h3 className="text-base font-semibold text-ink shrink-0">Supported hardware</h3>
                <ul className="flex flex-wrap gap-2">
                  {AVAILABLE.map((name) => (
                    <li key={name} className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-raised px-3 py-1 text-sm text-ink">
                      <span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden="true" />
                      {name}
                    </li>
                  ))}
                  {SOON.map((name) => (
                    <li key={name} className="inline-flex items-center gap-2 rounded-full border border-dashed border-line-strong px-3 py-1 text-sm text-ink-3">
                      {name}
                      <span className="text-xs">soon</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {staged && TOUR.map((_, i) => <Caption key={i} index={i} />)}
      </div>
    </section>
  );
}
