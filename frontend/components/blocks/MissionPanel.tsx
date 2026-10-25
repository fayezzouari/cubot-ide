'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, Lightbulb, LogOut, Play, RotateCcw, Trophy, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BLOCK_BY_TYPE, CATEGORY_BY_ID } from '@/lib/blocks/registry';
import type { Mission, ObjectiveResult } from '@/lib/blocks/missions';
import { blockIcon } from './blockIcons';

export function MissionPanel({
  mission,
  next,
  results,
  passed,
  running,
  onCheck,
  onRestart,
  onSolution,
  onExit,
  onAddBlock,
  onNext,
}: {
  mission: Mission;
  next: Mission | null;
  results: ObjectiveResult[] | null;
  passed: boolean;
  running: boolean;
  onCheck: () => void;
  onRestart: () => void;
  onSolution: () => void;
  onExit: () => void;
  onAddBlock: (type: string) => void;
  onNext: () => void;
}) {
  const [hints, setHints] = useState(0);
  const [confirmSolution, setConfirmSolution] = useState(false);

  useEffect(() => {
    setHints(0);
    setConfirmSolution(false);
  }, [mission.id]);

  const byId = new Map(results?.map((r) => [r.id, r]) ?? []);
  const done = results?.filter((r) => r.passed).length ?? 0;
  const complete = !!results && done === results.length;

  return (
    <div className="space-y-4 p-3 text-xs">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">Mission · {mission.level}</span>
          {passed && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
              <CheckCircle2 size={11} /> Passed
            </span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold text-white">{mission.title}</div>
        <div className="mt-2 space-y-2 leading-relaxed text-white/60">
          {mission.brief.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Blocks you will need</div>
        <div className="flex flex-wrap gap-1">
          {mission.blocks.map((type) => {
            const def = BLOCK_BY_TYPE[type];
            if (!def) return null;
            const Icon = blockIcon(type);
            return (
              <button
                key={type}
                disabled={running}
                onClick={() => onAddBlock(type)}
                title={`Add ${def.label} below the selected block`}
                className="flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.02] px-1.5 py-1 text-[11px] text-white/70 hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                <Icon size={11} style={{ color: CATEGORY_BY_ID[def.category]?.accent }} />
                {def.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Objectives
          {results && (
            <span className={`font-mono normal-case tracking-normal ${complete ? 'text-emerald-300' : 'text-white/45'}`}>
              {done} / {results.length}
            </span>
          )}
        </div>
        <ul className="space-y-1.5">
          {mission.objectives.map((o) => {
            const r = byId.get(o.id);
            return (
              <li key={o.id} className="flex gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <span className="mt-px shrink-0">
                  {!r ? <Circle size={13} className="text-white/25" /> : r.passed ? <CheckCircle2 size={13} className="text-emerald-400" /> : <XCircle size={13} className="text-red-400" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-white/80">{o.label}</span>
                  {r && <span className={`block text-[11px] ${r.passed ? 'text-white/40' : 'text-red-300/80'}`}>{r.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {complete && (
          <div className="mt-2 flex items-center gap-2 rounded border border-emerald-400/30 bg-emerald-400/[0.06] px-2 py-1.5 text-emerald-200">
            <Trophy size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">{next ? 'Mission complete.' : 'Mission complete. That was the last mission!'}</span>
            {next && (
              <Button size="sm" className="h-7 shrink-0 bg-emerald-600 text-xs text-white hover:bg-emerald-500" disabled={running} onClick={onNext}>
                Next: {next.title} <ArrowRight size={12} />
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-500" disabled={running} onClick={onCheck}>
          <Play size={12} /> Run & check
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={running} onClick={onRestart} title="Clear the canvas and reset the cell">
          <RotateCcw size={12} /> Restart
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-white/55" disabled={running} onClick={onExit}>
          <LogOut size={12} /> Leave mission
        </Button>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Hints</div>
        <ol className="space-y-1.5">
          {mission.hints.slice(0, hints).map((h, i) => (
            <li key={h} className="flex gap-2 rounded border border-amber-300/15 bg-amber-300/[0.04] px-2 py-1.5 leading-relaxed text-white/70">
              <span className="font-mono text-amber-300/70">{i + 1}</span>
              {h}
            </li>
          ))}
        </ol>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {hints < mission.hints.length ? (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-200/80" onClick={() => setHints(hints + 1)}>
              <Lightbulb size={12} /> {hints ? 'Next hint' : 'Show a hint'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 text-xs ${confirmSolution ? 'text-red-300' : 'text-white/55'}`}
              disabled={running}
              onClick={() => {
                if (!confirmSolution) return setConfirmSolution(true);
                setConfirmSolution(false);
                onSolution();
              }}
            >
              {confirmSolution ? 'Replace my blocks with the solution?' : 'Show the solution'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
