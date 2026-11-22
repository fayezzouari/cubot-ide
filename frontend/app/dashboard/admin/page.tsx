'use client';

import { useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { adminService } from '@/lib/api';
import type { AdminMetric, AdminMetricKey, AdminOverview, AdminUsage } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const RANGES = [7, 30, 90] as const;

const METRIC_COLORS: Record<AdminMetricKey, string> = {
  users: 'var(--color-ws-ide)',
  projects: 'var(--color-ws-cad)',
  ai_messages: 'var(--color-ws-fleet)',
  lessons_passed: 'var(--color-ws-blocks)',
};

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2';

const formatDay = (date: string, withYear = false) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear && { year: 'numeric' }),
    timeZone: 'UTC',
  });

function TodayDelta({ metric }: { metric: AdminMetric }) {
  const diff = metric.today - metric.yesterday;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  return (
    <p className="text-xs text-ink-3 mt-1">
      <span className="text-ink-2 tabular-nums">{metric.today}</span> today ·{' '}
      <span
        className={cn('tabular-nums', diff > 0 ? 'text-ok' : diff < 0 ? 'text-busy' : 'text-ink-3')}
        title={`${metric.yesterday} yesterday`}
      >
        {sign}{Math.abs(diff)}
      </span>{' '}
      vs yesterday
    </p>
  );
}

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [metric, setMetric] = useState<AdminMetricKey>('projects');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    adminService.overview()
      .then(data => { if (isMounted) setOverview(data); })
      .catch(err => { if (isMounted) setError(err?.message || 'Failed to load stats'); });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setUsage(null);
    adminService.usage(days)
      .then(data => { if (isMounted) setUsage(data); })
      .catch(err => { if (isMounted) setError(err?.message || 'Failed to load usage'); });
    return () => { isMounted = false; };
  }, [days]);

  const metrics = overview?.metrics ?? [];
  const selected = metrics.find(m => m.key === metric);
  const rangeTotal = usage?.points.reduce((sum, p) => sum + p[metric], 0) ?? 0;
  const color = METRIC_COLORS[metric];

  return (
    <div>
      <div className="flex items-center gap-2 text-ink-3 text-xs mb-3">
        <LayoutDashboard size={12} />
        Admin
      </div>
      <h1 className="text-3xl font-bold text-ink tracking-tight mb-1">Overview</h1>
      <p className="text-xs text-ink-3 mb-10">Platform totals. Days are counted in UTC.</p>

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 mb-6">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-line bg-line mb-10">
        {overview
          ? metrics.map(m => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                aria-pressed={metric === m.key}
                className={cn(
                  'text-left p-5 transition-colors cursor-pointer',
                  focusRing,
                  metric === m.key ? 'bg-raised' : 'bg-surface hover:bg-raised/60',
                )}
              >
                <p className="flex items-center gap-2 text-xs text-ink-3 mb-3">
                  <span className="w-2 h-2 rounded-full" style={{ background: METRIC_COLORS[m.key] }} />
                  {m.label}
                </p>
                <p className="text-3xl font-bold text-ink tabular-nums tracking-tight">{m.total.toLocaleString()}</p>
                <TodayDelta metric={m} />
              </button>
            ))
          : [...Array(4)].map((_, i) => <div key={i} className="h-[7.5rem] bg-surface animate-pulse" />)}
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-sm font-semibold text-ink-2 tracking-tight">
              {selected?.label ?? 'Usage'} per day
            </h2>
            <p className="text-xs text-ink-3 mt-1">
              <span className="text-ink-2 tabular-nums">{rangeTotal.toLocaleString()}</span> in the last {days} days
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-line p-0.5" role="group" aria-label="Date range">
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium tabular-nums transition-colors cursor-pointer',
                  focusRing,
                  days === r ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink',
                )}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        <div className="h-72">
          {usage ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={usage.points} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={d => formatDay(d)}
                  tick={{ fill: 'var(--color-ink-3)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'var(--color-ink-3)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--color-line-strong)' }}
                  contentStyle={{
                    background: 'var(--color-raised)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--color-ink-2)' }}
                  itemStyle={{ color: 'var(--color-ink)' }}
                  labelFormatter={d => formatDay(String(d), true)}
                  formatter={value => [value, selected?.label ?? metric]}
                />
                <Area
                  type="monotone"
                  dataKey={metric}
                  stroke={color}
                  strokeWidth={2}
                  fill="url(#usageFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full rounded-lg bg-raised/40 animate-pulse" />
          )}
        </div>
      </section>
    </div>
  );
}
