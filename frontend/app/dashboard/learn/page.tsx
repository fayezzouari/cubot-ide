'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronRight, CircleDot, GraduationCap, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { missionService, projectService } from '@/lib/api';
import { CompilerType, type MissionSummary } from '@/lib/api/types';
import { loadMissionProgress, MISSION_LEVELS, MISSIONS as BLOCKS_MISSIONS, type MissionStatus } from '@/lib/blocks/missions';

const BLOCKS_LESSONS_ID = 'blocks-lessons';

type Lesson = Pick<MissionSummary, 'id' | 'order' | 'track' | 'title' | 'summary' | 'concepts' | 'status'> & { difficulty: string; source: 'code' | 'blocks' };

const DIFFICULTY_ORDER = ['beginner', 'easy', 'intermediate', 'advanced', 'hard'];

const STATUS_LABEL: Record<MissionStatus, string> = {
  new: 'Start',
  started: 'Continue',
  passed: 'Review',
};

export default function LearnPage() {
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocksProgress, setBlocksProgress] = useState<Record<string, MissionStatus>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isMounted = true;
    missionService.list()
      .then(data => { if (isMounted) setMissions(data); })
      .catch(err => { if (isMounted) setError(err?.message || 'Failed to load missions'); })
      .finally(() => { if (isMounted) setIsLoading(false); });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    setBlocksProgress(loadMissionProgress());
  }, []);

  const lessons = useMemo<Lesson[]>(() => [
    ...missions.map(m => ({ ...m, source: 'code' as const })),
    ...MISSION_LEVELS.flatMap(level => BLOCKS_MISSIONS.filter(m => m.level === level.id)).map((m, i) => ({
        id: m.id,
        order: i + 1,
        track: 'Block programming',
        title: m.title,
        summary: m.summary,
        difficulty: m.level,
        concepts: m.concepts,
        status: blocksProgress[m.id] ?? 'new',
        source: 'blocks' as const,
      })),
  ], [missions, blocksProgress]);

  const sections = useMemo(() => {
    const byTrack = new Map<string, Lesson[]>();
    lessons.forEach(m => byTrack.set(m.track, [...(byTrack.get(m.track) ?? []), m]));
    return [...byTrack.entries()].map(([track, items]) => {
      const next = items.find(m => m.status !== 'passed');
      const levels = [...new Set(items.map(m => m.difficulty))]
        .sort((a, b) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b))
        .map(difficulty => ({
          key: `${track}:${difficulty}`,
          difficulty,
          items: items.filter(m => m.difficulty === difficulty),
          defaultOpen: next?.difficulty === difficulty,
        }));
      return { track, items, levels };
    });
  }, [lessons]);

  const passed = lessons.filter(m => m.status === 'passed').length;
  const nextUp = lessons.find(m => m.status !== 'passed');

  const openBlocksLesson = async (lesson: Lesson) => {
    const projects = await projectService.getAll();
    const project = projects.find(p => p.mission_id === BLOCKS_LESSONS_ID) ?? await projectService.create({
      name: 'Block programming lessons',
      description: 'Robot cell missions from the Learn section.',
      target_compiler: CompilerType.ARDUINO,
      mission_id: BLOCKS_LESSONS_ID,
    });
    localStorage.setItem('cubot-ide-last-project', project.id);
    localStorage.setItem(`cubot-ide-project-workspace-${project.id}`, 'blocks');
    window.location.assign(`/blocks?project=${project.id}&mission=${encodeURIComponent(lesson.id)}`);
  };

  const handleOpen = async (lesson: Lesson) => {
    if (opening) return;
    const key = `${lesson.source}-${lesson.id}`;
    setOpening(key);
    setError(null);
    try {
      if (lesson.source === 'blocks') {
        await openBlocksLesson(lesson);
        return;
      }
      const { project_id } = await missionService.start(lesson.id);
      localStorage.setItem('cubot-ide-last-project', project_id);
      localStorage.setItem(`cubot-ide-project-workspace-${project_id}`, 'ide');
      window.location.assign(`/ide?project=${project_id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not open the mission');
      setOpening(null);
    }
  };

  return (
    <div>
      <div className="mb-10">
        <div className="flex items-center gap-2 text-white/40 font-mono text-[10px] uppercase tracking-wider mb-3">
          <GraduationCap size={12} />
          Learn
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Missions</h1>
        <p className="text-sm text-white/45 max-w-xl leading-relaxed">
          Short hands-on challenges. Write the code, press Check, and CuBot runs it against real inputs to see
          if it works: Arduino sketches in the simulator, ROS 2 nodes in your own sandbox, and robot cells built
          with blocks. Stuck? Ask the Tutor for a hint.
        </p>

        {!isLoading && lessons.length > 0 && (
          <div className="mt-8 flex items-center gap-4">
            <div className="flex-1 h-1 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${(passed / lessons.length) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[11px] text-white/50 tabular-nums">
              {passed} / {lessons.length} passed
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-px rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.08]">
          {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-black animate-pulse" />)}
        </div>
      )}

      {sections.map(({ track, items, levels }) => (
        <section key={track} className="mb-10">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/60 tracking-tight">{track}</h2>
            <span className="font-mono text-[11px] text-white/35 tabular-nums">
              {items.filter(m => m.status === 'passed').length} / {items.length} passed
            </span>
          </div>
          <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
            {levels.map(level => (
              <Collapsible
                key={level.key}
                open={expanded[level.key] ?? level.defaultOpen}
                onOpenChange={open => setExpanded(prev => ({ ...prev, [level.key]: open }))}
              >
                <CollapsibleTrigger className="group flex w-full items-center gap-2 bg-black px-4 py-3 text-left hover:bg-[#0b0b0b] transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-[#0b0b0b]">
                  <ChevronRight size={13} className="text-white/40 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="text-xs font-medium text-white capitalize">{level.difficulty}</span>
                  <span className="ml-auto font-mono text-[11px] text-white/35 tabular-nums">
                    {level.items.filter(m => m.status === 'passed').length} / {level.items.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-px border-t border-white/[0.08] bg-white/[0.08]">
                    {level.items.map(mission => (
                      <button
                        key={`${mission.source}-${mission.id}`}
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
                            {opening === `${mission.source}-${mission.id}` ? <Loader2 size={11} className="animate-spin" /> : STATUS_LABEL[mission.status]}
                            {opening !== `${mission.source}-${mission.id}` && <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
