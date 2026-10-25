'use client';

import { useState } from 'react';
import { CheckCircle2, CircleDot } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { STATION_KINDS } from '@/lib/blocks/layout';
import { MISSION_LEVELS, MISSIONS, type Mission, type MissionLevel, type MissionStatus } from '@/lib/blocks/missions';
import { BLOCKS_THEME } from './theme';

const LEVEL_ACCENT: Record<MissionLevel, string> = {
  easy: 'text-emerald-300/80',
  intermediate: 'text-amber-300/80',
  hard: 'text-red-300/80',
};

function cellSummary(mission: Mission) {
  const counts = new Map<string, number>();
  for (const s of mission.layout.stations) {
    if (s.kind === 'beacon' || s.kind === 'fence') continue;
    const label = STATION_KINDS[s.kind].label.toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => (n > 1 ? `${n} ${label}s` : label)).join(' · ');
}

export function MissionGallery({
  open,
  onOpenChange,
  progress,
  activeId,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: Record<string, MissionStatus>;
  activeId: string | null;
  onStart: (m: Mission) => void;
}) {
  const [level, setLevel] = useState<MissionLevel>('easy');
  const list = MISSIONS.filter((m) => m.level === level);
  const passed = MISSIONS.filter((m) => progress[m.id] === 'passed').length;
  const info = MISSION_LEVELS.find((l) => l.id === level)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden border-white/10 bg-[#0c0c0d] p-0 text-white" style={BLOCKS_THEME}>
        <DialogHeader className="border-b border-white/[0.08] px-6 pb-4 pt-5">
          <DialogTitle>Missions</DialogTitle>
          <DialogDescription className="text-white/50">
            Each mission sets up its own cell. Add the blocks yourself, press Run, and the objectives are checked against
            the simulation. Starting a mission replaces the current canvas, poses, scene and environment.
          </DialogDescription>
          <div className="flex items-center gap-1 pt-3">
            {MISSION_LEVELS.map((l) => {
              const done = MISSIONS.filter((m) => m.level === l.id && progress[m.id] === 'passed').length;
              const total = MISSIONS.filter((m) => m.level === l.id).length;
              return (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${level === l.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
                >
                  {l.label}
                  <span className="font-mono text-[10px] text-white/35">
                    {done}/{total}
                  </span>
                </button>
              );
            })}
            <span className="ml-auto font-mono text-[11px] text-white/40">
              {passed} / {MISSIONS.length} passed
            </span>
          </div>
          <p className="pt-1 text-[11px] text-white/40">{info.description}</p>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-6 md:grid-cols-3">
          {list.map((m) => {
            const status = progress[m.id] ?? 'new';
            return (
              <div key={m.id} className="flex flex-col rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${LEVEL_ACCENT[m.level]}`}>{m.level}</span>
                  {status === 'passed' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
                      <CheckCircle2 size={11} /> Passed
                    </span>
                  ) : status === 'started' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300/80">
                      <CircleDot size={11} /> In progress
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm font-semibold">{m.title}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-white/55">{m.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {m.concepts.map((c) => (
                    <span key={c} className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/50">
                      {c}
                    </span>
                  ))}
                </div>
                <p className="mt-3 border-l-2 border-white/10 pl-2 text-[11px] leading-relaxed text-white/40">Cell: {cellSummary(m)}</p>
                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className="text-[10px] text-white/35">{m.objectives.length} objectives</span>
                  <Button size="sm" className="h-7 text-xs" onClick={() => onStart(m)}>
                    {activeId === m.id ? 'Restart' : status === 'passed' ? 'Play again' : 'Start mission'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
