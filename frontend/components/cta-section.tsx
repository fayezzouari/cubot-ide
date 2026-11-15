import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const PROOF = ['No credit card', 'No installation', 'Open source'];

const CALLOUTS = [
  { code: 'AGV-01', text: 'to dock, 38 s', x: 193, y: 460, shift: '-translate-x-1/2' },
  { code: 'AGV-02', text: 'waiting', x: 445, y: 566, shift: '-translate-x-1/3' },
  { code: '', text: 'Charging dock', x: 885, y: 282, shift: '-translate-x-[88%] -translate-y-full' },
];

export default function CTASection() {
  return (
    <section id="github" className="py-24 px-6">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-10 lg:gap-6">
        <div>
          <h2 className="text-4xl md:text-6xl font-bold text-ink mb-6 tracking-[-0.04em] leading-[1.05]">
            Build something real. No hardware required.
          </h2>
          <p className="text-base md:text-lg text-ink-2 mb-8 leading-relaxed max-w-md">
            CuBot is free and open-source. Open your browser, start a project, and
            go from code to virtual hardware in under a minute.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-ink hover:bg-white text-page font-medium text-sm rounded-lg transition-all"
            >
              Start Building Free
              <ArrowRight size={14} />
            </Link>
            <a
              href="https://github.com/fayezzouari/cubot-ide"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 border border-line hover:border-line-strong hover:bg-raised text-ink-2 hover:text-ink font-medium text-sm rounded-lg transition-all"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Star on GitHub
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 mt-12">
            {PROOF.map((item) => (
              <span key={item} className="text-sm text-ink-3">{item}</span>
            ))}
          </div>
        </div>

        <div className="relative" style={{ aspectRatio: '920 / 780' }} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/cta-fleet.svg" alt="" className="absolute inset-0 w-full h-full" />
          {CALLOUTS.map(({ code, text, x, y, shift }) => (
            <span
              key={text}
              className={`hidden sm:flex absolute items-center gap-2 h-9 px-3 rounded-lg bg-surface border border-line text-sm whitespace-nowrap ${shift}`}
              style={{ left: `${(x / 920) * 100}%`, top: `${(y / 780) * 100}%` }}
            >
              {code && <span className="font-mono text-ws-fleet">{code}</span>}
              <span className={code ? 'text-ink-2' : 'text-ink'}>{text}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
