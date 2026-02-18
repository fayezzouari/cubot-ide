'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/header';
import WorkspaceModal from '@/components/workspace-modal';
import { projectService } from '@/lib/api';
import type { ProjectResponse } from '@/lib/api/types';
import { Plus, ArrowRight, Trash2, Clock, Code2 } from 'lucide-react';
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

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectResponse | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProjects = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await projectService.getAll();
        if (isMounted) {
          setProjects(Array.isArray(data) ? data : []);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to load projects');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadProjects();
    return () => { isMounted = false; };
  }, []);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [projects]);

  const handleOpenProject = (project: ProjectResponse) => {
    const workspaceType =
      localStorage.getItem(`cubot-ide-project-workspace-${project.id}`) || 'ide';
    localStorage.setItem('cubot-ide-last-project', project.id);

    if (workspaceType === 'blocks') {
      router.push(`/blocks?project=${project.id}`);
    } else if (workspaceType === 'cad') {
      router.push(`/cad?session=${project.id}`);
    } else {
      router.push(`/ide?project=${project.id}`);
    }
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
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <main className="min-h-screen bg-background text-foreground font-sans">
      <Header />

      <div className="pt-14">
        {/* Page header */}
        <div className="border-b border-border px-6 py-8">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-muted-foreground mb-1">dashboard</p>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Projects</h1>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs rounded-md transition-colors cursor-pointer"
            >
              <Plus size={13} />
              New Project
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-6 py-8">
          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-36 rounded-lg border border-border bg-card animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && error && (
            <div className="p-4 border border-destructive/30 bg-destructive/5 rounded-lg">
              <p className="text-xs text-destructive font-mono">{error}</p>
            </div>
          )}

          {!isLoading && !error && sortedProjects.length === 0 && (
            <div className="border border-border border-dashed rounded-lg p-16 text-center">
              <div className="w-10 h-10 border border-border rounded-lg flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                <Code2 size={18} />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No projects yet</p>
              <p className="text-xs text-muted-foreground mb-5">Create your first project to get started.</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs rounded-md transition-colors cursor-pointer"
              >
                <Plus size={13} />
                New Project
              </button>
            </div>
          )}

          {!isLoading && !error && sortedProjects.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedProjects.map((project) => (
                <div
                  key={project.id}
                  className="group border border-border rounded-lg bg-card hover:border-foreground/20 transition-all"
                >
                  <div className="p-5">
                    {/* Header row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0 mr-3">
                        <h3 className="text-sm font-semibold text-foreground truncate">{project.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {project.description || 'No description'}
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-all cursor-pointer flex-shrink-0"
                            onClick={() => setProjectToDelete(project)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-card border-border">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm">Delete project</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs text-muted-foreground">
                              Are you sure you want to delete &ldquo;{project.name}&rdquo;? This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel
                              className="text-xs h-8"
                              onClick={() => setProjectToDelete(null)}
                            >
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleDeleteProject}
                              className="text-xs h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    {/* Footer row */}
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground px-1.5 py-0.5 bg-secondary rounded border border-border">
                          {project.target_compiler?.toUpperCase() || 'UNKNOWN'}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock size={10} />
                          {formatDate(project.updated_at)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleOpenProject(project)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground font-medium text-xs rounded-md transition-all cursor-pointer group/btn"
                      >
                        Open
                        <ArrowRight size={11} className="group-hover/btn:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <WorkspaceModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </main>
  );
}
