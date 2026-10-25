'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleDot, GraduationCap, Loader2 } from 'lucide-react';
import Header from '@/components/header';
import { missionService } from '@/lib/api';
import type { MissionSummary } from '@/lib/api/types';

const STATUS_LABEL: Record<MissionSummary['status'], string> = {
  new: 'Start',
  started: 'Continue',
  passed: 'Review',
};

export default function LearnPage() {
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    missionService.list()
      .then(data => { if (isMounted) setMissions(data); })
      .catch(err => { if (isMounted) setError(err?.message || 'Failed to load missions'); })
      .finally(() => { if (isMounted) setIsLoading(false); });
    return () => { isMounted = false; };
  }, []);

  const tracks = useMemo(() => {
    const byTrack = new Map<string, MissionSummary[]>();
    missions.forEach(m => byTrack.set(m.track, [...(byTrack.get(m.track) ?? []), m]));
    return [...byTrack.entries()];
  }, [missions]);

  const passed = missions.filter(m => m.status === 'passed').length;
  const nextUp = missions.find(m => m.status !== 'passed');

  const handleOpen = async (mission: MissionSummary) => {
    if (opening) return;
    setOpening(mission.id);
    setError(null);
    try {
      const { project_id } = await missionService.start(mission.id);
      localStorage.setItem('cubot-ide-last-project', project_id);
      localStorage.setItem(`cubot-ide-project-workspace-${project_id}`, 'ide');
      window.location.assign(`/ide?project=${project_id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not open the mission');
      setOpening(null);
    }
  };

  return (
    <main className="min-h-screen bg-black text-foreground font-sans">
      <Header />

      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-28 pb-16">
        <div className="mb-10">
          <div className="flex items-center gap-2 text-white/40 font-mono text-[10px] uppercase tracking-wider mb-3">
            <GraduationCap size={12} />
            Learn
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Missions</h1>
          <p className="text-sm text-white/45 max-w-xl leading-relaxed">
            Short hands-on challenges. Write the code, press Check, and CuBot runs it against real inputs to see
            if it works: Arduino sketches in the simulator, ROS 2 nodes in your own sandbox. Stuck? Ask the Tutor
            for a hint.
          </p>

          {!isLoading && missions.length > 0 && (
            <div className="mt-8 flex items-center gap-4">
              <div className="flex-1 h-1 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full bg-white transition-all"
                  style={{ width: `${(passed / missions.length) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-white/50 tabular-nums">
                {passed} / {missions.length} passed
              </span>
              {nextUp && (
                <button
                  onClick={() => handleOpen(nextUp)}
                  disabled={!!opening}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-white/90 text-black font-medium text-xs rounded-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {nextUp.status === 'new' && passed === 0 ? 'Start learning' : `Next: ${nextUp.title}`}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 mb-6">
            <p className="text-xs text-red-400 font-mono">{error}</p>
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.08]">
            {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-black animate-pulse" />)}
          </div>
        )}

        {tracks.map(([track, items]) => (
          <section key={track} className="mb-10">
            <h2 className="text-sm font-semibold text-white/60 tracking-tight mb-3">{track}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.08]">
              {items.map(mission => (
                <button
                  key={mission.id}
                  onClick={() => handleOpen(mission)}
                  disabled={!!opening}
                  className="group relative text-left bg-black p-6 transition-colors hover:bg-[#0b0b0b] focus-visible:outline-none focus-visible:bg-[#0b0b0b] cursor-pointer disabled:cursor-wait"
                >
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-[10px] font-mono text-white/25">{String(mission.order).padStart(2, '0')}</span>
                    {mission.status === 'passed' ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-green-400">
                        <CheckCircle2 size={11} /> Passed
                      </span>
                    ) : mission.status === 'started' ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
                        <CircleDot size={11} /> In progress
                      </span>
                    ) : null}
                  </div>

                  <h3 className="text-sm font-semibold text-white mb-1.5">{mission.title}</h3>
                  <p className="text-xs text-white/45 leading-relaxed mb-5 min-h-[2.5rem]">{mission.summary}</p>

                  <div className="flex flex-wrap gap-1 mb-5">
                    {mission.concepts.map(concept => (
                      <span key={concept} className="font-mono text-[10px] text-white/45 px-1.5 py-0.5 rounded border border-white/[0.08]">
                        {concept}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                    <span className="text-white/30">{mission.difficulty}</span>
                    <span className="inline-flex items-center gap-1 text-white/40 group-hover:text-white transition-colors">
                      {opening === mission.id ? <Loader2 size={11} className="animate-spin" /> : STATUS_LABEL[mission.status]}
                      {opening !== mission.id && <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
