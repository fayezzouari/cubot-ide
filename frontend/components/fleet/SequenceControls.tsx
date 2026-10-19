'use client';

import { Check, ChevronRight, ListOrdered } from 'lucide-react';
import type { SequenceMode, SequenceStatus } from '@/lib/fleet/types';
import { chipBtnCls } from './theme';

export function SequenceControls({
  mode,
  status,
  cursor,
  total,
  noun,
  onMode,
  onStart,
  onAdvance,
  onStop,
}: {
  mode: SequenceMode;
  status: SequenceStatus;
  cursor: number;
  total: number;
  noun: string;
  onMode: (mode: SequenceMode) => void;
  onStart: () => void;
  onAdvance: () => void;
  onStop: () => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6 text-[10px] text-white/40">
      <div className="inline-flex rounded border border-white/[0.08] p-0.5">
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => onMode(m)}
            disabled={status !== 'idle'}
            title={`Sequence mode: ${m}`}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              mode === m ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      {status === 'idle' && (
        <button onClick={onStart} className={chipBtnCls} title={`Lock this ${noun}'s assigned tasks into an explicit sequence`}>
          <ListOrdered size={11} /> Sequence
        </button>
      )}
      {status === 'running' && (
        <>
          <span className="font-mono tabular-nums text-white/55">
            {cursor + 1}/{total}
          </span>
          <button onClick={onStop} className={chipBtnCls}>
            Stop
          </button>
        </>
      )}
      {status === 'held' && (
        <>
          <span className="font-mono tabular-nums text-violet-300">
            {cursor + 1}/{total} held
          </span>
          <button
            onClick={onAdvance}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-emerald-500"
            title="Advance to the next task"
          >
            <ChevronRight size={11} /> Advance
          </button>
          <button onClick={onStop} className={chipBtnCls}>
            Stop
          </button>
        </>
      )}
      {status === 'completed' && (
        <>
          <span className="inline-flex items-center gap-1 text-emerald-300/80">
            <Check size={11} /> Sequence done
          </span>
          <button onClick={onStop} className={chipBtnCls}>
            Reset
          </button>
        </>
      )}
    </div>
  );
}
