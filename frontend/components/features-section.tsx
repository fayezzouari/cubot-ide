import type { ReactNode } from 'react';
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

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
            Built for the full development loop.
          </h2>
          <p className="text-base text-ink-2 leading-relaxed">
            What every workspace shares, so a project never has to leave the browser.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className={`${tile} md:col-span-2 lg:flex-row lg:items-center gap-6`}>
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

          <div className={tile}>
            <Stage>
              <RunsOnMock />
            </Stage>
            <Copy icon={Cloud} title="Nothing to install" line="A browser is all you need. Everything heavy runs for you." tint="text-ws-ide" />
          </div>

          <div className={tile}>
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

          <div className={tile}>
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

          <div className={`${tile} md:col-span-2 lg:col-span-3 lg:flex-row lg:items-center gap-4 lg:gap-8`}>
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
    </section>
  );
}
