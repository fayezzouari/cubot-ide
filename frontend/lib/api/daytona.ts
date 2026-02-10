/**
 * API client for Daytona workspace management
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export enum WorkspaceState {
  CREATING = 'creating',
  RUNNING = 'running',
  STOPPED = 'stopped',
  ERROR = 'error',
}

export interface DaytonaWorkspace {
  workspace_id: string;
  project_id: string;
  state: WorkspaceState;
  url?: string;
  ssh_url?: string;
  created_at: string;
  metadata: Record<string, any>;
}

export interface CodeExecutionRequest {
  workspace_id: string;
  code: string;
  language: string;
  timeout?: number;
  env_vars?: Record<string, string>;
}

export interface CodeExecutionResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  execution_time: number;
  error?: string;
}

export const daytonaApi = {
  async createWorkspace(projectId: string, repositoryUrl?: string): Promise<DaytonaWorkspace> {
    const response = await fetch(`${API_BASE}/daytona/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        repository_url: repositoryUrl,
        ide: 'vscode',
        env_vars: {},
      }),
    });
    if (!response.ok) throw new Error('Failed to create workspace');
    return response.json();
  },

  async getWorkspace(workspaceId: string): Promise<DaytonaWorkspace> {
    const response = await fetch(`${API_BASE}/daytona/workspaces/${workspaceId}`);
    if (!response.ok) throw new Error('Failed to fetch workspace');
    return response.json();
  },

  async stopWorkspace(workspaceId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/daytona/workspaces/${workspaceId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to stop workspace');
  },

  async executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResponse> {
    const response = await fetch(`${API_BASE}/daytona/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error('Failed to execute code');
    return response.json();
  },
};
