'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Trash2 } from 'lucide-react';
import type { Problem } from '@/lib/blocks/compiler';
import type { Value } from '@/lib/blocks/expression';
import type { LogEntry, TelemetryEntry } from '@/lib/blocks/interpreter';

type Tab = 'console' | 'problems' | 'variables' | 'telemetry' | 'serial';

const levelIcon = {
  info: <Info size={12} className="text-sky-300/70" />,
  warn: <AlertTriangle size={12} className="text-amber-300" />,
  error: <AlertCircle size={12} className="text-red-400" />,
  success: <CheckCircle2 size={12} className="text-emerald-400" />,
};

function AutoScroll({ dep, children }: { dep: unknown; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [dep]);
  return (
    <div ref={ref} className="h-full overflow-y-auto px-3 py-1.5 font-mono text-[11px]">
      {children}
    </div>
  );
}

export function ConsolePanel({
  logs,
  problems,
  variables,
  telemetry,
  serial,
  onClear,
  onSelectNode,
}: {
  logs: LogEntry[];
  problems: Problem[];
  variables: Record<string, Value>;
  telemetry: TelemetryEntry[];
  serial: { dir: 'tx' | 'rx'; line: string }[] | null;
  onClear: () => void;
  onSelectNode: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('console');
  const errors = problems.filter((p) => p.severity === 'error').length;
  const tabs: [Tab, string][] = [
    ['console', 'Console'],
    ['problems', `Problems${problems.length ? ` (${problems.length})` : ''}`],
    ['variables', 'Variables'],
    ['telemetry', `Telemetry${telemetry.length ? ` (${telemetry.length})` : ''}`],
  ];
  if (serial) tabs.push(['serial', 'Serial']);

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.08] px-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded px-2 py-1 text-[11px] ${tab === id ? 'bg-white/[0.07] text-white' : 'text-white/45 hover:text-white/70'} ${id === 'problems' && errors ? 'text-red-300' : ''}`}
          >
            {label}
          </button>
        ))}
        <button onClick={onClear} className="ml-auto rounded p-1 text-white/30 hover:text-white/60" title="Clear console">
          <Trash2 size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'console' && (
          <AutoScroll dep={logs.length}>
            {logs.length === 0 && <div className="py-2 text-white/25">Press Run to start the program. Output appears here.</div>}
            {logs.map((l) => (
              <div
                key={l.id}
                onClick={() => l.nodeId && onSelectNode(l.nodeId)}
                className={`flex items-start gap-2 py-0.5 ${l.nodeId ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}
              >
                <span className="w-14 shrink-0 text-right text-white/25">{l.time.toFixed(2)}s</span>
                <span className="mt-0.5">{levelIcon[l.level]}</span>
                <span className={l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-200' : 'text-white/75'}>
                  {l.message}
                </span>
              </div>
            ))}
          </AutoScroll>
        )}
        {tab === 'problems' && (
          <AutoScroll dep={problems.length}>
            {problems.length === 0 && <div className="py-2 text-emerald-300/70">No problems — the program is ready to run.</div>}
            {problems.map((p, i) => (
              <div
                key={i}
                onClick={() => p.nodeId && onSelectNode(p.nodeId)}
                className={`flex items-start gap-2 py-0.5 ${p.nodeId ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}
              >
                <span className="mt-0.5">{p.severity === 'error' ? levelIcon.error : levelIcon.warn}</span>
                <span className={p.severity === 'error' ? 'text-red-200' : 'text-amber-100'}>{p.message}</span>
              </div>
            ))}
          </AutoScroll>
        )}
        {tab === 'variables' && (
          <AutoScroll dep={null}>
            {Object.keys(variables).length === 0 && <div className="py-2 text-white/25">Variables appear here while the program runs.</div>}
            <div className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-6">
              {Object.entries(variables).map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="py-0.5 text-violet-300/80">{k}</span>
                  <span className="py-0.5 text-white/80">
                    {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : JSON.stringify(v)}
                  </span>
                </div>
              ))}
            </div>
          </AutoScroll>
        )}
        {tab === 'telemetry' && (
          <AutoScroll dep={telemetry.length}>
            {telemetry.length === 0 && (
              <div className="py-2 text-white/25">MQTT publish blocks show their messages here. The exported Python sends them to a real broker.</div>
            )}
            {telemetry.map((t) => (
              <div key={t.id} className="flex gap-2 py-0.5">
                <span className="w-14 shrink-0 text-right text-white/25">{t.time.toFixed(2)}s</span>
                <span className="text-sky-300/80">{t.topic}</span>
                <span className="text-white/75">{t.payload}</span>
              </div>
            ))}
          </AutoScroll>
        )}
        {tab === 'serial' && serial && (
          <AutoScroll dep={serial.length}>
            {serial.map((s, i) => (
              <div key={i} className={s.dir === 'tx' ? 'text-sky-300/80' : 'text-emerald-300/80'}>
                {s.dir === 'tx' ? '→ ' : '← '}
                {s.line}
              </div>
            ))}
          </AutoScroll>
        )}
      </div>
    </div>
  );
}
