'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/header';
import WorkspaceModal from '@/components/workspace-modal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { projectService } from '@/lib/api';
import type { ProjectResponse } from '@/lib/api/types';
import { Plus, ArrowRight, FolderOpen, Trash2 } from 'lucide-react';
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

    return () => {
      isMounted = false;
    };
  }, []);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = new Date(a.updated_at).getTime();
      const bTime = new Date(b.updated_at).getTime();
      return bTime - aTime;
    });
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
      // Refresh projects list
      const data = await projectService.getAll();
      setProjects(Array.isArray(data) ? data : []);
      setProjectToDelete(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete project');
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground font-sans">
      <Header />

      <section className="pt-28 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-foreground/70 tracking-widest">DASHBOARD</p>
              <h1 className="text-4xl md:text-5xl font-black text-foreground mt-2">
                Your Projects
              </h1>
            </div>
            <Button
              onClick={() => setIsModalOpen(true)}
              className="px-6 py-3 bg-primary border-4 border-foreground text-primary-foreground font-black text-sm hover:bg-muted hover:text-black transition-all flex items-center"
            >
              <Plus size={18} className="mr-2" />
              CREATE PROJECT
            </Button>
          </div>

          <div className="mt-10 grid gap-6">
            {isLoading && (
              <Card className="border-4 border-foreground">
                <CardContent className="p-8 font-bold">Loading projects...</CardContent>
              </Card>
            )}

            {!isLoading && error && (
              <Card className="border-4 border-foreground">
                <CardContent className="p-8 font-bold text-red-600">{error}</CardContent>
              </Card>
            )}

            {!isLoading && !error && sortedProjects.length === 0 && (
              <Card className="border-4 border-foreground">
                <CardContent className="p-8 font-bold">
                  No projects yet. Create one to get started.
                </CardContent>
              </Card>
            )}

            {!isLoading && !error && sortedProjects.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {sortedProjects.map((project) => (
                  <Card key={project.id} className="border-4 border-foreground">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-2xl font-black flex items-start justify-between gap-4">
                        <span className="truncate">{project.name}</span>
                        <div className="flex items-center gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                onClick={() => setProjectToDelete(project)}
                              >
                                <Trash2 size={18} />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Project</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{project.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setProjectToDelete(null)}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={handleDeleteProject}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <FolderOpen size={20} className="mt-1" />
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm font-bold text-foreground/70">
                        {project.description || 'No description provided.'}
                      </p>
                      <div className="text-xs font-black uppercase tracking-widest text-foreground/60">
                        Updated {new Date(project.updated_at).toLocaleString()}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black border-2 border-foreground px-2 py-1">
                          {project.target_compiler?.toUpperCase()}
                        </span>
                        <Button
                          onClick={() => handleOpenProject(project)}
                          className="px-4 py-2 bg-foreground text-background font-black text-xs hover:bg-muted hover:text-foreground transition-all flex items-center"
                        >
                          OPEN
                          <ArrowRight size={14} className="ml-2" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <WorkspaceModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </main>
  );
}
