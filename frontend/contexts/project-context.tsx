'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { projectService, fileService, compileService, chatService } from '@/lib/api';
import type {
  ProjectResponse,
  ProjectWithFiles,
  FileResponse,
  FileUpdate,
  CompileRequest,
  CompilationResponse,
  ChatRequest,
  ChatResponse,
  ChatMessageInDB,
} from '@/lib/api';

interface ProjectContextType {
  // Current project
  currentProject: ProjectWithFiles | null;
  setCurrentProject: (project: ProjectWithFiles | null) => void;
  
  // Project operations
  loadProject: (projectId: string) => Promise<void>;
  createProject: (name: string, description: string, compiler: string) => Promise<ProjectResponse>;
  
  // File operations
  createFile: (name: string, path: string, content: string, fileType: string) => Promise<FileResponse>;
  updateFile: (fileId: string, data: FileUpdate) => Promise<FileResponse>;
  deleteFile: (fileId: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  
  // Compilation
  compileProject: (mainFile: string, fileIds: string[], compiler: string) => Promise<CompilationResponse>;
  
  // Chat
  sendChatMessage: (message: string, fileContext?: any[]) => Promise<ChatResponse>;
  loadChatHistory: () => Promise<ChatMessageInDB[]>;
  
  // State
  isLoading: boolean;
  error: string | null;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentProject, setCurrentProject] = useState<ProjectWithFiles | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProject = useCallback(async (projectId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const project = await projectService.getWithFiles(projectId);
      setCurrentProject(project);
    } catch (err: any) {
      setError(err.message || 'Failed to load project');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createProject = useCallback(async (name: string, description: string, compiler: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const project = await projectService.create({
        name,
        description,
        target_compiler: compiler as any,
      });
      return project;
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createFile = useCallback(async (name: string, path: string, content: string, fileType: string) => {
    if (!currentProject) throw new Error('No project selected');
    
    setIsLoading(true);
    setError(null);
    try {
      const file = await fileService.create({
        project_id: currentProject.id,
        name,
        path,
        content,
        file_type: fileType as any,
      });
      
      // Refresh project to get updated files
      await loadProject(currentProject.id);
      
      return file;
    } catch (err: any) {
      setError(err.message || 'Failed to create file');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentProject, loadProject]);

  const updateFile = useCallback(async (fileId: string, data: FileUpdate) => {
    setIsLoading(true);
    setError(null);
    try {
      const file = await fileService.update(fileId, data);
      
      // Update in current project
      if (currentProject) {
        const updatedFiles = currentProject.files.map(f => 
          f.id === fileId ? { ...f, ...data } : f
        );
        setCurrentProject({ ...currentProject, files: updatedFiles });
      }
      
      return file;
    } catch (err: any) {
      setError(err.message || 'Failed to update file');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentProject]);

  const deleteFile = useCallback(async (fileId: string) => {
    if (!currentProject) throw new Error('No project selected');
    
    setIsLoading(true);
    setError(null);
    try {
      await fileService.delete(fileId);
      
      // Refresh project
      await loadProject(currentProject.id);
    } catch (err: any) {
      setError(err.message || 'Failed to delete file');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentProject, loadProject]);

  const refreshFiles = useCallback(async () => {
    if (!currentProject) return;
    await loadProject(currentProject.id);
  }, [currentProject, loadProject]);

  const compileProject = useCallback(async (mainFile: string, fileIds: string[], compiler: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const request: CompileRequest = {
        compiler: compiler as any,
        file_ids: fileIds,
        main_file: mainFile,
      };
      
      const result = await compileService.compile(request);
      return result;
    } catch (err: any) {
      setError(err.message || 'Compilation failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendChatMessage = useCallback(async (message: string, fileContext?: any[]) => {
    if (!currentProject) throw new Error('No project selected');
    
    setIsLoading(true);
    setError(null);
    try {
      const request: ChatRequest = {
        message,
        file_context: fileContext,
        compiler: currentProject.target_compiler,
      };
      
      const response = await chatService.sendMessage(currentProject.id, request);
      return response;
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentProject]);

  const loadChatHistory = useCallback(async () => {
    if (!currentProject) throw new Error('No project selected');
    
    setIsLoading(true);
    setError(null);
    try {
      const history = await chatService.getHistory(currentProject.id);
      return history;
    } catch (err: any) {
      setError(err.message || 'Failed to load chat history');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentProject]);

  const value: ProjectContextType = {
    currentProject,
    setCurrentProject,
    loadProject,
    createProject,
    createFile,
    updateFile,
    deleteFile,
    refreshFiles,
    compileProject,
    sendChatMessage,
    loadChatHistory,
    isLoading,
    error,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
