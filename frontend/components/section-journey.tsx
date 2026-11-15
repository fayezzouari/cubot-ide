'use client';

import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import TrackDivider, { LineFollower } from '@/components/track-divider';
import { cn } from '@/lib/utils';

export interface JourneyStop {
  label: string;
  anchor?: string;
  content: ReactNode;
}

const DWELL = 0.6;
const STAGED ='(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)';

export default function SectionJourney({ stops }: { stops: JourneyStop[] }) {
  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const contents = useRef<(HTMLDivElement | null)[]>([]);
  const robot = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const [staged, setStaged] = useState(false);
  const [active, setActive] = useState(0);
  const [fits, setFits] = useState<number[]>([]);
  const last = stops.length - 1;

  useEffect(() => {
    const query = window.matchMedia(STAGED);
    const sync = () => setStaged(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!staged) return;
    const onScroll = () => {
      const el = root.current;
      if (!el) return;
      const travel = el.offsetHeight - window.innerHeight;
      const progress = Math.min(Math.max(-el.getBoundingClientRect().top / travel, 0), 1);
      const units = progress * (last + DWELL);
      const stop = Math.min(Math.floor(units), last);
      const drive = stop < last ? Math.min(Math.max((units - stop - DWELL) / (1 - DWELL), 0), 1) : 0;
      const position = ((stop + drive) / last) * 100;
      if (robot.current) robot.current.style.left = `${position}%`;
      if (trail.current) trail.current.style.width = `${position}%`;
      setActive(stop);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [staged, last]);

  useEffect(() => {
    if (!staged) return;
    const measure = () => {
      const room = (area.current?.clientHeight ?? 0) - 24;
      setFits(contents.current.map((el) => (el && el.offsetHeight > room ? room / el.offsetHeight : 1)));
    };
    const observer = new ResizeObserver(measure);
    if (area.current) observer.observe(area.current);
    contents.current.forEach((el) => el && observer.observe(el));
    measure();
    return () => observer.disconnect();
  }, [staged]);

  const go = useCallback(
    (index: number) => {
      const el = root.current;
      if (!el) return;
      const travel = el.offsetHeight - window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY + (travel * (index + DWELL / 4)) / (last + DWELL);
      window.scrollTo({ top, behavior: 'smooth' });
    },
    [last],
  );

  useEffect(() => {
    if (!staged) return;
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href^="#"]');
      const anchor = link?.getAttribute('href')?.slice(1);
      const index = anchor ? stops.findIndex((stop) => stop.anchor === anchor) : -1;
      if (index < 0) return;
      event.preventDefault();
      go(index);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [staged, stops, go]);

  return (
    <div ref={root} style={staged ? { height: `${(stops.length + DWELL) * 100}vh` } : undefined}>
      <div className={staged ? 'sticky top-0 h-screen flex flex-col pt-20 overflow-hidden' : undefined}>
        <div ref={area} className={staged ? 'relative flex-1 min-h-0' : undefined}>
          {stops.map((stop, i) => (
            <Fragment key={stop.label}>
              {!staged && i > 0 && <TrackDivider delay={-i * 4} />}
              <div
                inert={staged && i !== active}
                className={
                  staged
                    ? cn(
                        'absolute inset-0 flex items-center justify-center transition-opacity duration-500',
                        i === active ? 'opacity-100' : 'opacity-0',
                      )
                    : undefined
                }
              >
                <div
                  ref={(el) => {
                    contents.current[i] = el;
                  }}
                  className={staged ? 'w-full [&>section]:py-0 [&>section]:px-10 xl:[&>section]:px-16 [&>section>div]:max-w-none' : undefined}
                  style={staged ? { transform: `scale(${fits[i] ?? 1})` } : undefined}
                >
                  {stop.content}
                </div>
              </div>
            </Fragment>
          ))}
        </div>

        {staged && (
          <nav aria-label="Sections" className="shrink-0 w-full px-10 xl:px-16 h-24">
            <div className="relative h-full mx-10">
              <div className="absolute inset-x-0 top-8 h-px bg-line" />
              <div ref={trail} className="absolute left-0 top-8 h-px bg-ink-2" style={{ width: 0 }} />
              {stops.map((stop, i) => (
                <button
                  key={stop.label}
                  onClick={() => go(i)}
                  aria-current={i === active ? 'step' : undefined}
                  className="group absolute top-8 -translate-x-1/2 flex flex-col items-center cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
                  style={{ left: `${(i / last) * 100}%` }}
                >
                  <span
                    className={cn(
                      'block w-2.5 h-2.5 -translate-y-1/2 rounded-full border transition-colors',
                      i <= active ? 'bg-ink border-ink' : 'bg-well border-line-strong group-hover:border-ink-3',
                    )}
                  />
                  <span
                    className={cn(
                      'mt-3 text-sm whitespace-nowrap transition-colors',
                      i === active ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2',
                    )}
                  >
                    {stop.label}
                  </span>
                </button>
              ))}
              <div ref={robot} className="absolute top-8 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: 0 }} aria-hidden="true">
                <LineFollower />
              </div>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
