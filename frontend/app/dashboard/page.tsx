'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Plus, ArrowRight, Trash2, Code2, Cpu, Blocks, Box, Route, X, Loader2 } from 'lucide-react';
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

const getWorkspace = (projectId: string) => {
  const ws = typeof window !== 'undefined'
    ? localStorage.getItem(`cubot-ide-project-workspace-${projectId}`) || 'ide'
    : 'ide';
  if (ws === 'blocks') return { id: ws, Icon: Blocks, label: 'Blocks' };
  if (ws === 'cad') return { id: ws, Icon: Box, label: 'CAD' };
  if (ws === 'fleet') return { id: ws, Icon: Route, label: 'Fleet' };
  return { id: 'ide', Icon: Code2, label: 'IDE' };
};

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

  const nextLesson = missions.find(m => m.status !== 'passed');
  const trackLessons = nextLesson ? missions.filter(m => m.track === nextLesson.track) : [];
  const firstName = session?.user?.name?.split(' ')[0];
  const now = new Date();
  const today = `${now.toLocaleDateString('en-GB', { weekday: 'long' })} · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;

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
    { label: 'Projects', value: isLoading ? '—' : sortedProjects.length, detail: `of ${PROJECT_LIMIT} slots` },
    { label: 'Lessons', value: activity?.lessons.passed ?? '—', detail: activity ? `of ${activity.lessons.total} passed` : '' },
    { label: 'Categories', value: activity?.categories.length ?? '—', detail: activity?.categories.map(c => c.name).join(' · ') ?? '' },
    {
      label: 'Checks run',
      value: activity?.lessons.attempts ?? '—',
      detail: activity ? `${activity.lessons.in_progress} lesson${activity.lessons.in_progress === 1 ? '' : 's'} in progress` : '',
    },
  ];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/45 mb-3.5">{today}</p>
          <h1 className="text-5xl lg:text-[56px] font-bold text-white tracking-[-0.04em] leading-none mb-3.5">
            Hey{firstName ? ` ${firstName}` : ''}.
          </h1>
          <p className="text-base text-white/55">
            {sortedProjects[0]
              ? `${sortedProjects[0].name} was your last edit, ${formatLastEdit(sortedProjects[0].updated_at)}.`
              : 'Start a project, or pick up a lesson below.'}
          </p>
        </div>
        <button
          onClick={handleNewProject}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-white/90 text-black font-semibold text-sm rounded-[10px] transition-all cursor-pointer flex-shrink-0 self-start sm:self-auto"
        >
          <Plus size={14} strokeWidth={2.4} />
          New project
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-px rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.08] mb-12">
        {stats.map(stat => (
          <div key={stat.label} className="bg-black px-6 py-5 min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45 mb-1.5">{stat.label}</p>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-4xl font-bold text-white tracking-[-0.03em] tabular-nums leading-10">{stat.value}</span>
              <span className="font-mono text-xs text-white/45 truncate">{stat.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 mb-6">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-10 xl:gap-14 xl:items-start">
        <section className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-semibold text-white tracking-[-0.01em]">Projects</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">Recently edited</span>
          </div>

          {isLoading && (
            <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
              {[...Array(3)].map((_, i) => <div key={i} className="h-[78px] bg-black animate-pulse" />)}
            </div>
          )}

          {!isLoading && !error && sortedProjects.length === 0 && (
            <div className="rounded-xl border border-white/[0.08] border-dashed p-16 text-center">
              <div className="w-10 h-10 rounded-[10px] border border-white/[0.12] flex items-center justify-center mx-auto mb-4">
                <Cpu size={16} className="text-white/40" />
              </div>
              <p className="text-sm font-medium text-white/70 mb-1">No projects yet</p>
              <p className="text-xs text-white/40 mb-6">Create your first project to get started.</p>
              <button
                onClick={handleNewProject}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-white/90 text-black font-semibold text-xs rounded-lg transition-all cursor-pointer"
              >
                <Plus size={12} />
                New project
              </button>
            </div>
          )}

          {!isLoading && sortedProjects.length > 0 && (
            <div className="rounded-xl border border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden">
              {sortedProjects.map(project => {
                const { id: workspace, Icon, label } = getWorkspace(project.id);
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
                    className="group flex items-center gap-4 px-5 py-[18px] bg-black hover:bg-[#0b0b0b] focus-visible:outline-none focus-visible:bg-[#0b0b0b] transition-colors cursor-pointer"
                  >
                    <div className="w-10 h-10 flex-shrink-0 rounded-[10px] border border-white/[0.12] flex items-center justify-center text-white/80 group-hover:border-white/30 group-hover:text-white transition-colors">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-white truncate leading-5">{project.name}</p>
                      <p className="text-[13px] text-white/55 truncate mt-1">{project.description || 'No description'}</p>
                    </div>
                    <span className="hidden md:block w-20 flex-shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-white/90">{label}</span>
                    <span className="hidden md:block w-20 flex-shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-white/55">
                      {workspace === 'fleet' ? '—' : project.target_compiler || '—'}
                    </span>
                    <span className="hidden lg:block w-16 flex-shrink-0 font-mono text-xs text-white/55">
                      {workspace === 'fleet' ? '—' : `${project.file_count ?? 0} file${project.file_count === 1 ? '' : 's'}`}
                    </span>
                    <span className="hidden sm:block w-20 flex-shrink-0 text-right font-mono text-xs text-white/55">{formatRelative(project.updated_at)}</span>
                    <div className="w-12 flex-shrink-0 flex items-center justify-end gap-1">
                      <button
                        title="Delete project"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToDelete(project);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-md text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                      <ArrowRight size={14} className="text-white/45 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {missions.length > 0 && (
          <aside className="xl:w-[340px] flex-shrink-0 xl:mt-10 rounded-xl border border-white/[0.08] bg-black p-6 flex flex-col gap-5">
            {nextLesson ? (
              <>
                <div className={cn(
                  'flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]',
                  nextLesson.status === 'started' ? 'text-amber-300/80' : 'text-white/55',
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', nextLesson.status === 'started' ? 'bg-amber-300' : 'bg-white/60')} />
                  {nextLesson.status === 'started' ? 'In progress' : 'Up next'}
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white tracking-[-0.02em] leading-7 mb-2">{nextLesson.title}</h3>
                  <p className="text-sm text-white/55 leading-5">{nextLesson.summary}</p>
                </div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-between font-mono text-xs">
                    <span className="text-white/55">{nextLesson.track}</span>
                    <span className="text-white tabular-nums">
                      {trackLessons.filter(m => m.status === 'passed').length} / {trackLessons.length}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {trackLessons.map(m => (
                      <span
                        key={m.id}
                        className={cn(
                          'flex-1 h-1 rounded-full',
                          m.status === 'passed'
                            ? 'bg-green-400'
                            : m.id === nextLesson.id
                              ? m.status === 'started' ? 'bg-amber-300/80' : 'bg-white/60'
                              : 'bg-white/[0.12]',
                        )}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => handleOpenLesson(nextLesson)}
                    disabled={openingLesson}
                    className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white hover:bg-white/90 text-black font-semibold text-[13px] rounded-[10px] transition-all cursor-pointer disabled:opacity-60"
                  >
                    {nextLesson.status === 'started' ? 'Continue lesson' : 'Start lesson'}
                    {openingLesson ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} strokeWidth={2.4} />}
                  </button>
                  <Link href="/dashboard/learn" className="font-mono text-xs text-white/55 hover:text-white transition-colors">
                    All lessons →
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-green-400">All passed</p>
                <p className="text-sm text-white/55">Every code lesson is done. Try the block programming track next.</p>
                <Link href="/dashboard/learn" className="font-mono text-xs text-white/55 hover:text-white transition-colors">
                  All lessons →
                </Link>
              </>
            )}
          </aside>
        )}
      </div>

      <WorkspaceModal open={isModalOpen} onOpenChange={setIsModalOpen} />

      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => { if (!open) setProjectToDelete(null); }}>
        <AlertDialogContent className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm text-white">Delete project</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-white/40">
              Are you sure you want to delete &ldquo;{projectToDelete?.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8 rounded-lg border-white/[0.08] bg-transparent text-white/60 hover:bg-white/[0.06]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="text-xs h-8 rounded-lg bg-red-500/90 hover:bg-red-500 text-white border-0"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isLimitModalOpen} onOpenChange={setIsLimitModalOpen}>
        <DialogContent className="max-w-sm bg-[#0e0e0e] border border-white/[0.08] rounded-xl p-0 gap-0 shadow-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-white/[0.06] flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-sm font-semibold text-white leading-none mb-1">Project limit reached</DialogTitle>
              <p className="text-xs text-white/40">You&apos;ve reached the maximum of {PROJECT_LIMIT} projects.</p>
            </div>
            <button
              onClick={() => setIsLimitModalOpen(false)}
              className="p-1 text-white/20 hover:text-white/60 transition-colors cursor-pointer flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-xs text-white/50 leading-relaxed">
              Our project budget is not high enough for users to create a lot of projects.
              Please cope with the provided limitations — thank you for your understanding!
            </p>
            <button
              onClick={() => setIsLimitModalOpen(false)}
              className="w-full inline-flex items-center justify-center px-4 py-2 bg-white hover:bg-white/90 text-black font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              Got it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
