import { apiClient } from './client';
import type {
  FileResponse,
  FileCreate,
  FileUpdate,
  ProjectResponse,
  ProjectCreate,
  ProjectUpdate,
  ProjectWithFiles,
  CompileRequest,
  CompilationResponse,
  ChatRequest,
  ChatResponse,
  ChatMessageInDB,
  CompilerType,
} from './types';

// File Service
export const fileService = {
  create: (data: FileCreate) => 
    apiClient.post<FileResponse>('/files/', data),

  get: (fileId: string) => 
    apiClient.get<FileResponse>(`/files/${fileId}`),

  getByProject: (projectId: string) => 
    apiClient.get<FileResponse[]>(`/files/project/${projectId}`),

  getByPath: (projectId: string, path: string) => 
    apiClient.get<FileResponse>(`/files/project/${projectId}/path/${path}`),

  update: (fileId: string, data: FileUpdate) => 
    apiClient.put<FileResponse>(`/files/${fileId}`, data),

  delete: (fileId: string) => 
    apiClient.delete(`/files/${fileId}`),
};

// Project Service
export const projectService = {
  create: (data: ProjectCreate) => 
    apiClient.post<ProjectResponse>('/projects/', data),

  get: (projectId: string) => 
    apiClient.get<ProjectResponse>(`/projects/${projectId}`),

  getWithFiles: async (projectId: string) => {
    const [project, files] = await Promise.all([
      apiClient.get<ProjectResponse>(`/projects/${projectId}`),
      apiClient.get<FileResponse[]>(`/files/project/${projectId}`),
    ]);
    return {
      ...project,
      files,
    } as ProjectWithFiles;
  },

  getAll: () => 
    apiClient.get<ProjectResponse[]>('/projects/'),

  update: (projectId: string, data: ProjectUpdate) => 
    apiClient.put<ProjectResponse>(`/projects/${projectId}`, data),

  delete: (projectId: string) => 
    apiClient.delete(`/projects/${projectId}`),
};

// Compilation Service
export const compileService = {
  compile: (data: CompileRequest) => 
    apiClient.post<CompilationResponse>('/compile/', data),

  downloadBinary: async (
    projectId: string,
    compiler: CompilerType,
    mainFile: string,
    buildFlags?: string[]
  ) => {
    const params = new URLSearchParams({
      compiler,
      main_file: mainFile,
    });
    if (buildFlags) {
      buildFlags.forEach(flag => params.append('build_flags', flag));
    }
    return apiClient.download(`/compile/download-binary/${projectId}?${params}`);
  },

  listCompilers: () => 
    apiClient.get<{
      compilers: Array<{
        id: string;
        name: string;
        description: string;
        extensions: string[];
      }>;
    }>('/compile/compilers'),

  checkStatus: () => 
    apiClient.get<{
      docker_available: boolean;
      message: string;
    }>('/compile/status'),
};

// Chat Service
export const chatService = {
  sendMessage: (projectId: string, data: ChatRequest) => 
    apiClient.post<ChatResponse>(`/chat/${projectId}`, data),

  getHistory: (projectId: string, limit: number = 50) => 
    apiClient.get<ChatMessageInDB[]>(`/chat/${projectId}/history?limit=${limit}`),

  applyOperations: (projectId: string, operations: any[]) => 
    apiClient.post<{ results: any[] }>(
      `/chat/${projectId}/apply-operations`,
      operations
    ),
};
