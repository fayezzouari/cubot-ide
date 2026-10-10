import { apiClient } from './client';
import type { Pose, ProgramSettings } from '@/lib/blocks/types';

export interface BlockNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

export interface BlockEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  style?: Record<string, any>;
}

export interface BlockProgram {
  id?: string;
  project_id: string;
  name: string;
  nodes: BlockNode[];
  edges: BlockEdge[];
  poses?: Pose[] | null;
  settings?: ProgramSettings | null;
  created_at?: string;
  updated_at?: string;
}

export const blocksApi = {
  createProgram: (program: Omit<BlockProgram, 'id' | 'created_at' | 'updated_at'>) =>
    apiClient.post<BlockProgram>('/blocks/programs', program),

  getPrograms: (projectId?: string) =>
    apiClient.get<BlockProgram[]>(`/blocks/programs${projectId ? `?project_id=${projectId}` : ''}`),

  getProgram: (programId: string) =>
    apiClient.get<BlockProgram>(`/blocks/programs/${programId}`),

  updateProgram: (programId: string, updates: Partial<BlockProgram>) =>
    apiClient.put<BlockProgram>(`/blocks/programs/${programId}`, updates),

  deleteProgram: (programId: string) =>
    apiClient.delete(`/blocks/programs/${programId}`),
};
