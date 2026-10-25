'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Lightbulb,
  Loader2,
  MessageCircleQuestion,
  Play,
  XCircle,
} from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import { compileService, missionService } from '@/lib/api';
import type { CompilerType, Mission, MissionRun, MissionSummary } from '@/lib/api/types';

interface MissionPanelProps {
  missionId: string;
  projectId: string;
  files: Array<{ id: string; name: string; path?: string }>;
  hasUnsavedChanges: boolean;
  onSave: () => Promise<void>;
  onAskTutor: (prompt: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

type Phase = 'idle' | 'saving' | 'compiling' | 'simulating' | 'sandbox';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Check',
  saving: 'Saving…',
  compiling: 'Compiling…',
  simulating: 'Running checks…',
  sandbox: 'Running checks…',
};

export default function MissionPanel({
  missionId, projectId, files, hasUnsavedChanges, onSave, onAskTutor, collapsed, onToggleCollapsed,
}: MissionPanelProps) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [tab, setTab] = useState<'brief' | 'results'>('brief');
  const [phase, setPhase] = useState<Phase>('idle');
  const [run, setRun] = useState<MissionRun | null>(null);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const [hintsShown, setHintsShown] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextMission, setNextMission] = useState<MissionSummary | null>(null);
  const [openingNext, setOpeningNext] = useState(false);

  useEffect(() => {
    missionService.get(missionId)
      .then(setMission)
      .catch(err => setLoadError(err?.message || 'Could not load the mission'));
    missionService.list()
      .then(all => {
        const current = all.find(m => m.id === missionId);
        setNextMission(current ? all.find(m => m.order > current.order) ?? null : null);
      })
      .catch(() => setNextMission(null));
  }, [missionId]);

  const openNextMission = async () => {
    if (!nextMission || openingNext) return;
    setOpeningNext(true);
    try {
      const { project_id } = await missionService.start(nextMission.id);
      localStorage.setItem('cubot-ide-last-project', project_id);
      localStorage.setItem(`cubot-ide-project-workspace-${project_id}`, 'ide');
      window.location.assign(`/ide?project=${project_id}`);
    } catch {
      setOpeningNext(false);
    }
  };

  const passed = run?.passed ?? mission?.status === 'passed';
  const isRos = mission?.kind === 'ros2';

  const handleCheck = useCallback(async () => {
    if (phase !== 'idle') return;
    setTab('results');
    setRun(null);
    setCompileErrors([]);
    try {
      if (hasUnsavedChanges) {
        setPhase('saving');
        await onSave();
      }
      if (isRos) {
        setPhase('sandbox');
        setRun(await missionService.checkInSandbox(missionId, projectId));
        return;
      }
      setPhase('compiling');
      const mainFile = files.find(f => f.name.endsWith('.ino')) ?? files[0];
      if (!mainFile) {
        setCompileErrors(['The project has no sketch file.']);
        return;
      }
      const build = await compileService.compile({
        project_id: projectId,
        main_file: mainFile.path || mainFile.name,
        file_ids: files.map(f => f.id),
        compiler: 'arduino' as CompilerType,
      });
      if (!build.success || !build.hex_output) {
        setCompileErrors(build.errors?.length ? build.errors : [build.output || 'Compilation failed']);
        return;
      }
      setPhase('simulating');
      setRun(await missionService.check(missionId, build.hex_output, projectId));
    } catch (err: any) {
      setCompileErrors([err?.message || 'The check could not run']);
    } finally {
      setPhase('idle');
    }
  }, [phase, hasUnsavedChanges, onSave, isRos, files, projectId, missionId]);

  const askAboutFailure = () => {
    if (compileErrors.length > 0) {
      onAskTutor(`My code does not compile. Help me understand the error without fixing it for me:\n\n\`\`\`\n${compileErrors.join('\n')}\n\`\`\``);
      return;
    }
    const failed = run?.results.filter(r => !r.passed) ?? [];
    const lines = failed.map(r => `- ${r.label}: ${r.detail}`).join('\n');
    const output = isRos && run?.serial ? `\n\nMy node printed:\n\`\`\`\n${run.serial.slice(-1500)}\n\`\`\`` : '';
    onAskTutor(`My mission check failed:\n${lines}${output}\n\nWhat should I look at? Give me a hint, not the answer.`);
  };

  if (loadError) {
    return <div className="h-full bg-[#0a0a0a] border-t border-white/[0.06] p-4 text-xs text-red-400 font-mono">{loadError}</div>;
  }

  const busy = phase !== 'idle';
  const failedCount = run ? run.results.filter(r => !r.passed).length : 0;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] border-t border-white/[0.06] min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.04]">
        <GraduationCap size={13} className="text-white/50" />
        <span className="font-mono text-[10px] text-white/30">
          {mission ? String(mission.order).padStart(2, '0') : '··'}
        </span>
        <span className="text-[12px] font-semibold text-white/85 truncate">{mission?.title ?? 'Mission'}</span>
        {passed && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-green-400">
            <CheckCircle2 size={11} /> Passed
          </span>
        )}

        {!collapsed && (
          <div className="ml-3 flex items-center gap-0.5">
            {(['brief', 'results'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2 py-1 rounded text-[11px] capitalize transition-colors cursor-pointer ${
                  tab === t ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void handleCheck()}
            disabled={busy || !mission}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {PHASE_LABEL[phase]}
          </button>
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {!mission ? (
            <div className="space-y-2">
              <div className="h-3 w-2/3 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-white/[0.06] rounded animate-pulse" />
            </div>
          ) : tab === 'brief' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-white/35 mb-1">Goal</p>
                <p className="text-[12.5px] text-white/85 leading-relaxed">{mission.goal}</p>
              </div>

              <MarkdownRenderer content={mission.brief} className="text-[12.5px]" />

              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-white/35 mb-2">What gets checked</p>
                <ul className="space-y-1">
                  {mission.checks.map(check => (
                    <li key={check.id} className="flex items-center gap-2 text-[12px] text-white/60">
                      <span className="w-1 h-1 rounded-full bg-white/30" />
                      {check.label}
                    </li>
                  ))}
                </ul>
              </div>

              {mission.hints.length > 0 && (
                <div className="space-y-2">
                  {mission.hints.slice(0, hintsShown).map((hint, i) => (
                    <div key={i} className="flex gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-3 py-2">
                      <Lightbulb size={12} className="mt-0.5 flex-shrink-0 text-amber-300/80" />
                      <p className="text-[12px] leading-relaxed text-white/70 font-mono whitespace-pre-wrap">{hint}</p>
                    </div>
                  ))}
                  {hintsShown < mission.hints.length && (
                    <button
                      onClick={() => setHintsShown(n => n + 1)}
                      className="inline-flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                    >
                      <Lightbulb size={11} />
                      {hintsShown === 0 ? 'Show a hint' : `Show hint ${hintsShown + 1} of ${mission.hints.length}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {busy && (
                <div className="flex items-center gap-2 text-[12px] text-white/50">
                  <Loader2 size={12} className="animate-spin" />
                  {phase === 'simulating'
                    ? `Running your sketch in the simulator for ${(mission.duration_ms / 1000).toFixed(1)} s…`
                    : phase === 'sandbox'
                      ? `Running your nodes in the ROS 2 sandbox for ${(mission.duration_ms / 1000).toFixed(1)} s… The first check also starts the sandbox, which can take a minute.`
                      : PHASE_LABEL[phase]}
                </div>
              )}

              {!busy && !run && compileErrors.length === 0 && (
                <p className="text-[12px] text-white/35">
                  {isRos
                    ? 'Press Check to run your nodes in the ROS 2 sandbox against the mission.'
                    : 'Press Check to compile your sketch and run it against the mission.'}
                </p>
              )}

              {compileErrors.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-3">
                  <p className="text-[12px] font-medium text-red-300 mb-1.5">It does not compile yet</p>
                  <pre className="font-mono text-[11px] leading-relaxed text-red-200/70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {compileErrors.join('\n')}
                  </pre>
                </div>
              )}

              {run && (
                <>
                  {run.passed ? (
                    <div className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/[0.05] px-3 py-2.5">
                      <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-[12.5px] font-medium text-green-300">Mission passed</p>
                        <p className="text-[11px] text-white/45">
                          {isRos ? 'Every check passed in the ROS 2 sandbox.' : 'Every check passed in the simulator.'}
                        </p>
                      </div>
                      {nextMission ? (
                        <button
                          onClick={() => void openNextMission()}
                          disabled={openingNext}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {openingNext ? <Loader2 size={11} className="animate-spin" /> : null}
                          Next: {nextMission.title}
                          {!openingNext && <ArrowRight size={11} />}
                        </button>
                      ) : (
                        <Link
                          href="/learn"
                          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-white/50 hover:text-white transition-colors"
                        >
                          All missions <ArrowRight size={11} />
                        </Link>
                      )}
                    </div>
                  ) : run.error ? (
                    <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5 text-[12px] text-amber-200/80">
                      {run.error}
                    </div>
                  ) : (
                    <p className="text-[12px] text-white/60">
                      {failedCount} of {run.results.length} check{run.results.length === 1 ? '' : 's'} failed.
                    </p>
                  )}

                  <ul className="space-y-1.5">
                    {run.results.map(result => (
                      <li key={result.id} className="flex gap-2">
                        {result.passed
                          ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-green-400" />
                          : <XCircle size={13} className="mt-0.5 flex-shrink-0 text-red-400" />}
                        <div className="min-w-0">
                          <p className="text-[12px] text-white/80">{result.label}</p>
                          <p className="text-[11px] text-white/40">{result.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {run.serial && (
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-white/35 mb-1">
                        {isRos ? 'Node output' : 'Serial output'}
                      </p>
                      <pre className="rounded-md bg-black border border-white/[0.06] px-3 py-2 font-mono text-[11px] leading-relaxed text-white/55 whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {run.serial}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {!busy && (compileErrors.length > 0 || (run && !run.passed && !run.error)) && (
                <button
                  onClick={askAboutFailure}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-white/[0.1] bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer"
                >
                  <MessageCircleQuestion size={12} />
                  Ask the tutor
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
