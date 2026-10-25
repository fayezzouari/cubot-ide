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
  CompileExplainRequest,
  CompileExplainResponse,
  ChatRequest,
  ChatResponse,
  ChatMessageInDB,
  AgentEvent,
  ThreadSummary,
  CompilerType,
  WiringRequest,
  WiringResponse,
  StepExecutionRequest,
  StepExecutionResponse,
  Mission,
  MissionRun,
  MissionStart,
  MissionSummary,
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

  explainLogs: (data: CompileExplainRequest) =>
    apiClient.post<CompileExplainResponse>('/compile/explain', data),

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

  /** One agent turn as a live event stream. Abort the signal to stop the agent. */
  stream: (projectId: string, data: ChatRequest, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) =>
    apiClient.stream<AgentEvent>(`/chat/${projectId}/stream`, data, onEvent, signal),

  getHistory: (projectId: string, limit: number = 200, threadId?: string) =>
    apiClient.get<ChatMessageInDB[]>(
      `/chat/${projectId}/history?limit=${limit}${threadId ? `&thread_id=${encodeURIComponent(threadId)}` : ''}`,
    ),

  listThreads: (projectId: string) =>
    apiClient.get<ThreadSummary[]>(`/chat/${projectId}/threads`),

  createThread: (projectId: string, title?: string) =>
    apiClient.post<ThreadSummary>(`/chat/${projectId}/threads`, { title }),

  renameThread: (projectId: string, threadId: string, title: string) =>
    apiClient.put<{ success: boolean }>(`/chat/${projectId}/threads/${threadId}`, { title }),

  deleteThread: (projectId: string, threadId: string) =>
    apiClient.delete<{ success: boolean }>(`/chat/${projectId}/threads/${threadId}`),

  applyOperations: (projectId: string, operations: any[]) =>
    apiClient.post<{ results: any[] }>(
      `/chat/${projectId}/apply-operations`,
      operations
    ),

  executeStep: (projectId: string, data: StepExecutionRequest) =>
    apiClient.post<StepExecutionResponse>(`/chat/${projectId}/execute-step`, data),

  clearHistory: (projectId: string) =>
    apiClient.delete<{ success: boolean }>(`/chat/${projectId}/history`),
};

// Wiring Service
export const wiringService = {
  generate: (data: WiringRequest) =>
    apiClient.post<WiringResponse>('/wiring/generate', data),
};

export const missionService = {
  list: () =>
    apiClient.get<MissionSummary[]>('/missions/'),

  get: (missionId: string) =>
    apiClient.get<Mission>(`/missions/${missionId}`),

  start: (missionId: string) =>
    apiClient.post<MissionStart>(`/missions/${missionId}/start`, {}),

  check: (missionId: string, hex: string, projectId?: string) =>
    apiClient.post<MissionRun>(`/missions/${missionId}/check`, { hex, project_id: projectId }),

  checkInSandbox: (missionId: string, projectId: string) =>
    apiClient.post<MissionRun>(`/missions/${missionId}/check`, { project_id: projectId }),
};
