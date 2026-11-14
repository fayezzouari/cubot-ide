'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Plus, ArrowRight, Trash2, Code2, Cpu, Blocks, Box, Route, Loader2 } from 'lucide-react';
import WorkspaceModal from '@/components/workspace-modal';
import { missionService, projectService, userService } from '@/lib/api';
import type { MissionSummary, ProjectResponse, UserActivity } from '@/lib/api/types';
import { formatLastEdit, formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

const PROJECT_LIMIT = 3;

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2';
const solidButton = cn('inline-flex items-center justify-center gap-2 px-4 h-9 bg-ink hover:bg-white text-page font-semibold text-sm rounded-lg transition-colors cursor-pointer', focusRing);
const quietButton = cn('inline-flex items-center justify-center gap-2 px-4 h-9 border border-line-strong hover:border-ink-3 hover:bg-raised text-ink font-medium text-sm rounded-lg transition-colors cursor-pointer', focusRing);
const chip = 'px-2 py-0.5 rounded-full border border-line text-xs text-ink-2 whitespace-nowrap';
const enter = 'animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both motion-reduce:animate-none';

const WORKSPACES = {
  ide: { id: 'ide', Icon: Code2, label: 'IDE', tint: 'text-ws-ide bg-ws-ide/10 border-ws-ide/25' },
  blocks: { id: 'blocks', Icon: Blocks, label: 'Blocks', tint: 'text-ws-blocks bg-ws-blocks/10 border-ws-blocks/25' },
  cad: { id: 'cad', Icon: Box, label: 'CAD', tint: 'text-ws-cad bg-ws-cad/10 border-ws-cad/25' },
  fleet: { id: 'fleet', Icon: Route, label: 'Fleet', tint: 'text-ws-fleet bg-ws-fleet/10 border-ws-fleet/25' },
} as const;

const getWorkspace = (projectId: string) => {
  const ws = typeof window !== 'undefined'
    ? localStorage.getItem(`cubot-ide-project-workspace-${projectId}`) || 'ide'
    : 'ide';
  return WORKSPACES[ws as keyof typeof WORKSPACES] ?? WORKSPACES.ide;
};

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (value <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min((now - start) / 600, 1);
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown}</>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectResponse | null>(null);
  const [openingLesson, setOpeningLesson] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await projectService.getAll();
        if (isMounted) setProjects(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (isMounted) setError(err?.message || 'Failed to load projects');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    load();
    userService.activity().then(data => { if (isMounted) setActivity(data); }).catch(() => {});
    missionService.list().then(data => { if (isMounted) setMissions(data); }).catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const sortedProjects = useMemo(() =>
    projects.filter(p => !p.mission_id).sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    ), [projects]);

  const lastProject = sortedProjects[0];
  const lastWorkspace = lastProject ? getWorkspace(lastProject.id) : null;
  const nextLesson = missions.find(m => m.status !== 'passed');
  const trackLessons = nextLesson ? missions.filter(m => m.track === nextLesson.track) : [];
  const firstName = session?.user?.name?.split(' ')[0];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const handleNewProject = () => {
    if (sortedProjects.length >= PROJECT_LIMIT) {
      setIsLimitModalOpen(true);
    } else {
      setIsModalOpen(true);
    }
  };

  const handleOpenProject = (project: ProjectResponse) => {
    const ws = getWorkspace(project.id).id;
    localStorage.setItem('cubot-ide-last-project', project.id);
    if (ws === 'blocks') router.push(`/blocks?project=${project.id}`);
    else if (ws === 'cad') router.push(`/cad?session=${project.id}`);
    else if (ws === 'fleet') router.push(`/fleet?project=${project.id}`);
    else router.push(`/ide?project=${project.id}`);
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    try {
      await projectService.delete(projectToDelete.id);
      const data = await projectService.getAll();
      setProjects(Array.isArray(data) ? data : []);
      setProjectToDelete(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete project');
    }
  };

  const handleOpenLesson = async (mission: MissionSummary) => {
    if (openingLesson) return;
    setOpeningLesson(true);
    try {
      const { project_id } = await missionService.start(mission.id);
      localStorage.setItem('cubot-ide-last-project', project_id);
      localStorage.setItem(`cubot-ide-project-workspace-${project_id}`, 'ide');
      window.location.assign(`/ide?project=${project_id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not open the lesson');
      setOpeningLesson(false);
    }
  };

  const stats = [
    !isLoading && { label: `of ${PROJECT_LIMIT} projects`, value: sortedProjects.length },
    activity && activity.lessons.total > 0 && { label: `of ${activity.lessons.total} lessons passed`, value: activity.lessons.passed },
    activity && activity.lessons.in_progress > 0 && {
      label: `lesson${activity.lessons.in_progress === 1 ? '' : 's'} in progress`,
      value: activity.lessons.in_progress,
    },
    activity && activity.lessons.attempts > 0 && {
      label: `check${activity.lessons.attempts === 1 ? '' : 's'} run`,
      value: activity.lessons.attempts,
    },
    activity && activity.categories.length > 0 && {
      label: activity.categories.length === 1 ? 'category' : 'categories',
      value: activity.categories.length,
      title: activity.categories.map(c => c.name).join(', '),
    },
  ].filter(Boolean) as { label: string; value: number; title?: string }[];

  return (
    <>
      {error && (
        <div className="p-4 rounded-xl border border-red-400/25 bg-red-400/5 mb-6">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="h-[264px] rounded-xl bg-surface animate-pulse mb-6" />
      ) : (
        <section className={cn('p-6 sm:p-8 mb-6 rounded-xl bg-raised border border-line-strong', enter)}>
          <p className="text-sm text-ink-3 mb-6">{today}</p>
          <h1 className="text-xl font-medium text-ink-2 tracking-tight">
            Hey{firstName ? ` ${firstName}` : ''}, {lastProject ? 'pick up' : 'start your first project'}
            {lastProject && (
              <span className="block text-4xl sm:text-5xl font-bold text-ink tracking-tight leading-tight truncate mt-1">
                {lastProject.name}
              </span>
            )}
          </h1>
          {lastProject && lastWorkspace ? (
            <div className="flex flex-wrap items-center gap-1.5 mt-5">
              <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs whitespace-nowrap', lastWorkspace.tint)}>
                <lastWorkspace.Icon size={12} />
                {lastWorkspace.label}
              </span>
              {lastWorkspace.id !== 'fleet' && lastProject.target_compiler && (
                <span className={cn(chip, 'font-mono')}>{lastProject.target_compiler}</span>
              )}
              {lastWorkspace.id !== 'fleet' && (
                <span className={chip}>{lastProject.file_count ?? 0} file{lastProject.file_count === 1 ? '' : 's'}</span>
              )}
              <span className="text-sm text-ink-2 ml-1.5">edited {formatLastEdit(lastProject.updated_at)}</span>
            </div>
          ) : (
            <p className="text-sm text-ink-2 mt-3">Write firmware, snap blocks, model a part or plan a fleet.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-8">
            {lastProject && (
              <button onClick={() => handleOpenProject(lastProject)} className={cn(solidButton, 'group')}>
                Open project
                <ArrowRight size={14} strokeWidth={2.4} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}
            <button onClick={handleNewProject} className={lastProject ? quietButton : solidButton}>
              <Plus size={14} strokeWidth={2.4} />
              New project
            </button>
          </div>
        </section>
      )}

      {stats.length > 0 && (
        <ul
          style={{ animationDelay: '160ms' }}
          className={cn('flex flex-wrap gap-x-8 gap-y-2 px-1 mb-10', enter)}
        >
          {stats.map(stat => (
            <li key={stat.label} title={stat.title} className="flex items-baseline gap-2">
              <span className="text-xl font-semibold text-ink tabular-nums"><CountUp value={stat.value} /></span>
              <span className="text-sm text-ink-2">{stat.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div
        style={{ animationDelay: '240ms' }}
        className={cn('flex flex-col xl:flex-row gap-8 xl:gap-10 xl:items-start', enter)}
      >
        <section className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-ink">Projects</h2>
            <span className="text-sm text-ink-3">Most recent first</span>
          </div>

          {isLoading && (
            <div className="rounded-xl border border-line divide-y divide-line overflow-hidden">
              {[...Array(3)].map((_, i) => <div key={i} className="h-[76px] bg-surface animate-pulse" />)}
            </div>
          )}

          {!isLoading && !error && sortedProjects.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-10 text-center">
              <div className="w-10 h-10 rounded-lg border border-line-strong flex items-center justify-center mx-auto mb-3">
                <Cpu size={16} className="text-ink-3" />
              </div>
              <p className="text-sm text-ink-2">Your projects will be listed here.</p>
            </div>
          )}

          {!isLoading && sortedProjects.length > 0 && (
            <div className="rounded-xl border border-line divide-y divide-line overflow-hidden">
              {sortedProjects.map(project => {
                const { id: workspace, Icon, label, tint } = getWorkspace(project.id);
                return (
                  <div
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenProject(project)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenProject(project);
                      }
                    }}
                    className="group flex items-center gap-4 px-5 py-4 bg-surface hover:bg-raised focus-visible:outline-none focus-visible:bg-raised transition-colors cursor-pointer"
                  >
                    <div className={cn('w-10 h-10 flex-shrink-0 rounded-lg border flex items-center justify-center', tint)}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-ink truncate leading-5">{project.name}</p>
                      {project.description && (
                        <p className="text-sm text-ink-2 truncate mt-1">{project.description}</p>
                      )}
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                      <span className={chip}>{label}</span>
                      {workspace !== 'fleet' && project.target_compiler && (
                        <span className={cn(chip, 'font-mono')}>{project.target_compiler}</span>
                      )}
                      {workspace !== 'fleet' && (
                        <span className={chip}>{project.file_count ?? 0} file{project.file_count === 1 ? '' : 's'}</span>
                      )}
                    </div>
                    <span className="hidden sm:block w-20 flex-shrink-0 text-right text-sm text-ink-3 tabular-nums">{formatRelative(project.updated_at)}</span>
                    <div className="w-12 flex-shrink-0 flex items-center justify-end gap-1">
                      <button
                        title="Delete project"
                        aria-label={`Delete ${project.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToDelete(project);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={cn('opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-lg text-ink-3 hover:text-red-300 hover:bg-red-400/10 transition-all cursor-pointer', focusRing)}
                      >
                        <Trash2 size={14} />
                      </button>
                      <ArrowRight size={14} className="text-ink-3 group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {missions.length > 0 && (
          <aside className="xl:w-[340px] flex-shrink-0 xl:mt-9 rounded-xl border border-line bg-surface p-6 flex flex-col gap-5">
            {nextLesson ? (
              <>
                <div className={cn('flex items-center gap-2 text-sm', nextLesson.status === 'started' ? 'text-busy' : 'text-ink-2')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', nextLesson.status === 'started' ? 'bg-busy' : 'bg-ink-3')} />
                  {nextLesson.status === 'started' ? 'Lesson in progress' : 'Next lesson'}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-ink tracking-tight leading-7 mb-2">{nextLesson.title}</h3>
                  <p className="text-sm text-ink-2 leading-5">{nextLesson.summary}</p>
                </div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-2">{nextLesson.track}</span>
                    <span className="text-ink tabular-nums">
                      {trackLessons.filter(m => m.status === 'passed').length} of {trackLessons.length}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {trackLessons.map(m => (
                      <span
                        key={m.id}
                        className={cn(
                          'flex-1 h-1 rounded-full',
                          m.status === 'passed'
                            ? 'bg-ok'
                            : m.id === nextLesson.id
                              ? m.status === 'started' ? 'bg-busy' : 'bg-ink-3'
                              : 'bg-line',
                        )}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => handleOpenLesson(nextLesson)}
                    disabled={openingLesson}
                    className={cn(lastProject ? quietButton : solidButton, 'disabled:opacity-60')}
                  >
                    {nextLesson.status === 'started' ? 'Continue lesson' : 'Start lesson'}
                    {openingLesson && <Loader2 size={14} className="animate-spin" />}
                  </button>
                  <Link href="/dashboard/learn" className={cn('text-sm text-ink-2 hover:text-ink rounded-lg transition-colors', focusRing)}>
                    All lessons
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ok">All lessons passed</p>
                <p className="text-sm text-ink-2">Every code lesson is done. Try the block programming track next.</p>
                <Link href="/dashboard/learn" className={cn('text-sm text-ink-2 hover:text-ink rounded-lg transition-colors', focusRing)}>
                  All lessons
                </Link>
              </>
            )}
          </aside>
        )}
      </div>

      <WorkspaceModal open={isModalOpen} onOpenChange={setIsModalOpen} />

      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => { if (!open) setProjectToDelete(null); }}>
        <AlertDialogContent className="bg-raised border border-line-strong rounded-xl shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-ink">Delete project</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-ink-2">
              Delete &ldquo;{projectToDelete?.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-sm h-9 rounded-lg border-line-strong bg-transparent text-ink hover:bg-surface hover:text-ink">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="text-sm h-9 rounded-lg bg-red-400/90 hover:bg-red-400 text-page font-semibold border-0"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isLimitModalOpen} onOpenChange={setIsLimitModalOpen}>
        <DialogContent className="max-w-sm bg-raised border border-line-strong rounded-xl p-6 gap-4 shadow-2xl">
          <DialogTitle className="text-base font-semibold text-ink pr-8">
            You have {PROJECT_LIMIT} of {PROJECT_LIMIT} projects
          </DialogTitle>
          <p className="text-sm text-ink-2 leading-relaxed">
            Projects are capped at {PROJECT_LIMIT} to keep hosting costs covered. Delete one to start another.
          </p>
          <button onClick={() => setIsLimitModalOpen(false)} className={cn(solidButton, 'w-full')}>
            Got it
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
