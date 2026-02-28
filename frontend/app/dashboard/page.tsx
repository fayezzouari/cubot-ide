'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/header';
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

  const getWorkspaceIcon = (projectId: string) => {
    const ws = typeof window !== 'undefined'
      ? localStorage.getItem(`cubot-ide-project-workspace-${projectId}`) || 'ide'
      : 'ide';
    if (ws === 'blocks') return Blocks;
    if (ws === 'cad') return Box;
    return Code2;
  };

  return (
    <main className="min-h-screen bg-black text-foreground font-sans">
      <Header />
            {/* Subtle dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 3px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="max-w-5xl mx-auto px-6 pt-28 pb-16">

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
              <div key={i} className="h-40 rounded-xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
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
              const WorkspaceIcon = getWorkspaceIcon(project.id);
              return (
                <div
                  key={project.id}
                  className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all"
                >
                  <div className="p-5">
                    {/* Icon + name */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                          <WorkspaceIcon size={14} className="text-white/50" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-white truncate leading-tight">
                            {project.name}
                          </h3>
                          <p className="text-xs text-white/30 mt-0.5 truncate">
                            {project.description || 'No description'}
                          </p>
                        </div>
                      </div>

                      {/* Delete */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all cursor-pointer flex-shrink-0 ml-2"
                            onClick={() => setProjectToDelete(project)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl shadow-2xl">
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-mono text-white/25 px-1.5 py-0.5 rounded-md border border-white/[0.06] bg-white/[0.03]">
                          {project.target_compiler?.toUpperCase() || 'UNKNOWN'}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-white/25">
                          <Clock size={9} />
                          {formatDate(project.updated_at)}
                        </span>
                      </div>

                      <button
                        onClick={() => handleOpenProject(project)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white/40 hover:text-white border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.06] rounded-lg transition-all cursor-pointer group/btn"
                      >
                        Open
                        <ArrowRight size={10} className="group-hover/btn:translate-x-0.5 transition-transform" />
                      </button>
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
              <p className="text-sm font-semibold text-white leading-none mb-1">Project limit reached</p>
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
