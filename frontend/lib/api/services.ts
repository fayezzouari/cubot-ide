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
  CompilerType,
  WiringRequest,
  WiringResponse,
  CadChatRequest,
  CadChatResponse,
  CadSessionHistory,
  CadSSEEvent,
  StepExecutionRequest,
  StepExecutionResponse,
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

  getHistory: (projectId: string, limit: number = 50) => 
    apiClient.get<ChatMessageInDB[]>(`/chat/${projectId}/history?limit=${limit}`),

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

// CAD Service
export const cadService = {
  generate: (sessionId: string, data: CadChatRequest) =>
    apiClient.post<CadChatResponse>(`/cad/${sessionId}/generate`, data),

  getHistory: (sessionId: string) =>
    apiClient.get<CadSessionHistory>(`/cad/${sessionId}/history`),

  exportStl: async (cadqueryCode: string): Promise<Blob> => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
    const response = await fetch(`${API_BASE_URL}/cad/export-stl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cadquery_code: cadqueryCode }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Export failed');
    }
    return response.blob();
  },

  generatePlanned: async (
    sessionId: string,
    data: CadChatRequest,
    onEvent: (event: CadSSEEvent) => void,
  ): Promise<void> => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
    const response = await fetch(`${API_BASE_URL}/cad/${sessionId}/generate-planned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(errText || 'Stream failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const event: CadSSEEvent = JSON.parse(payload);
          onEvent(event);
        } catch {
          // ignore malformed lines
        }
      }
    }
  },
};
