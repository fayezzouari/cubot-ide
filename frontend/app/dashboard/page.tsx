'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/header';
import CRTWarp from '@/components/ui/CRTWarp';
import WorkspaceModal from '@/components/workspace-modal';
import { projectService } from '@/lib/api';
import type { ProjectResponse } from '@/lib/api/types';
import { Plus, ArrowRight, Trash2, Clock, Code2, Cpu, Blocks, Box, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectResponse | null>(null);

  const PROJECT_LIMIT = 3;

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
    return () => { isMounted = false; };
  }, []);

  const sortedProjects = useMemo(() =>
    [...projects].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    ), [projects]);

  const handleNewProject = () => {
    if (sortedProjects.length >= PROJECT_LIMIT) {
      setIsLimitModalOpen(true);
    } else {
      setIsModalOpen(true);
    }
  };

  const handleOpenProject = (project: ProjectResponse) => {
    const ws = localStorage.getItem(`cubot-ide-project-workspace-${project.id}`) || 'ide';
    localStorage.setItem('cubot-ide-last-project', project.id);
    if (ws === 'blocks') router.push(`/blocks?project=${project.id}`);
    else if (ws === 'cad') router.push(`/cad?session=${project.id}`);
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

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Icon, label and accent colour for the workspace a project was last opened in.
  const getWorkspace = (projectId: string) => {
    const ws = typeof window !== 'undefined'
      ? localStorage.getItem(`cubot-ide-project-workspace-${projectId}`) || 'ide'
      : 'ide';
    if (ws === 'blocks') return { Icon: Blocks, label: 'Blocks', accent: '#a78bfa' };
    if (ws === 'cad') return { Icon: Box, label: 'CAD', accent: '#fbbf24' };
    return { Icon: Code2, label: 'IDE', accent: '#60a5fa' };
  };

  return (
    <main className="min-h-screen bg-black text-foreground font-sans">
      <Header />
      {/* Animated CRT background, kept faint so it stays behind the content */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-45">
        <CRTWarp
          color="#b9aec2"
          backgroundColor="#000000"
          speed={0.25}
          curvature={0.25}
          scanlineStrength={0.2}
          scanlineFrequency={200}
          waveAmplitude={0.3}
          waveFrequency={2.5}
          bloom={0.6}
          bloomRadius={1}
          noise={0.04}
          vignette={0.6}
          brightness={0.5}
          pixelation={1}
          rgbShift={0.006}
          mouseReact
          mouseStrength={0.25}
          dpr={1}
          fps={30}
          paused={false}
        />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-28 pb-16">

        {/* Page header */}
        <div className="mb-8">
          {session?.user?.name && (
            <>
              <p className="text-3xl font-bold text-white mb-4 tracking-tight">Hey {session.user.name},</p>
              <div className="h-px bg-white/[0.16] mb-8" />
            </>
          )}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-white/60 tracking-tight">Projects</h1>
              <p className="text-xs text-white/30 mt-0.5 font-mono">
                {isLoading ? '—' : `${sortedProjects.length} project${sortedProjects.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              onClick={handleNewProject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-white/90 text-black font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              <Plus size={12} />
              New Project
            </button>
          </div>
        </div>

        {/* Error */}
        {!isLoading && error && (
          <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 mb-6">
            <p className="text-xs text-red-400 font-mono">{error}</p>
          </div>
        )}

        {/* Skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-44 rounded-2xl border border-white/10 bg-[#0b0b0f]/80 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && sortedProjects.length === 0 && (
          <div className="rounded-xl border border-white/[0.06] border-dashed p-20 text-center">
            <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center mx-auto mb-4">
              <Cpu size={18} className="text-white/20" />
            </div>
            <p className="text-sm font-medium text-white/60 mb-1">No projects yet</p>
            <p className="text-xs text-white/25 mb-6">Create your first project to get started.</p>
            <button
              onClick={handleNewProject}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-white/90 text-black font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              <Plus size={12} />
              New Project
            </button>
          </div>
        )}

        {/* Project grid */}
        {!isLoading && !error && sortedProjects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedProjects.map((project) => {
              const { Icon: WorkspaceIcon, label: workspaceLabel, accent } = getWorkspace(project.id);
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
                  style={{ ['--accent' as string]: accent }}
                  className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0f]/90 shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:shadow-[0_12px_40px_color-mix(in_srgb,var(--accent)_18%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {/* Accent line and corner glow */}
                  <div
                    className="absolute inset-x-0 top-0 h-px opacity-70 transition-opacity group-hover:opacity-100"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
                  />
                  <div
                    className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-25"
                    style={{ background: accent }}
                  />
                  <div className="relative p-5">
                    {/* Icon + name */}
                    <div className="flex items-start justify-between mb-5">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
                          style={{ background: `${accent}1a`, borderColor: `${accent}40`, color: accent }}
                        >
                          <WorkspaceIcon size={18} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-white truncate leading-tight">
                            {project.name}
                          </h3>
                          <p className="text-xs text-white/50 mt-1 line-clamp-2 leading-relaxed">
                            {project.description || 'No description'}
                          </p>
                        </div>
                      </div>

                      {/* Delete */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer flex-shrink-0 ml-2"
                            title="Delete project"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectToDelete(project);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Trash2 size={13} />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent
                          className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm text-white">Delete project</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-white/40">
                              Are you sure you want to delete &ldquo;{project.name}&rdquo;? This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel
                              className="text-xs h-8 rounded-lg border-white/[0.08] bg-transparent text-white/60 hover:bg-white/[0.06]"
                              onClick={() => setProjectToDelete(null)}
                            >
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
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-2 pt-4 border-t border-white/[0.07]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-md border"
                          style={{ color: accent, background: `${accent}14`, borderColor: `${accent}33` }}
                        >
                          {workspaceLabel}
                        </span>
                        <span className="text-[10px] font-mono text-white/60 px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.04]">
                          {project.target_compiler?.toUpperCase() || 'UNKNOWN'}
                        </span>
                        <span className="text-[10px] text-white/45 px-1">
                          {project.file_count ?? 0} file{project.file_count === 1 ? '' : 's'}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-white/45">
                          <Clock size={10} />
                          {formatDate(project.updated_at)}
                        </span>
                      </div>

                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/50 group-hover:text-white transition-colors flex-shrink-0">
                        Open
                        <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* New project card */}
            <button
              onClick={handleNewProject}
              className="rounded-xl border border-dashed border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.02] transition-all p-5 flex flex-col items-center justify-center gap-2 min-h-[10rem] cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-lg border border-dashed border-white/[0.1] group-hover:border-white/20 flex items-center justify-center transition-colors">
                <Plus size={14} className="text-white/25 group-hover:text-white/50 transition-colors" />
              </div>
              <span className="text-xs text-white/25 group-hover:text-white/50 transition-colors">New Project</span>
            </button>
          </div>
        )}

      </div>

      <WorkspaceModal open={isModalOpen} onOpenChange={setIsModalOpen} />

      {/* Project limit modal */}
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
    </main>
  );
}
