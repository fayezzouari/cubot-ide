import { apiClient } from './client';

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
  created_at?: string;
  updated_at?: string;
}

export interface ArmState {
  position: { x: number; y: number; z: number };
  joints: number[];
  is_moving: boolean;
}

export const blocksApi = {
  // Block Programs
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

  // Arm Control
  getArmState: () =>
    apiClient.get<ArmState>('/blocks/arm/state'),

  moveArmPosition: (x: number, y: number, z: number) =>
    apiClient.post(`/blocks/arm/move-position?x=${x}&y=${y}&z=${z}`),

  moveArmJoint: (joint: number, angle: number) =>
    apiClient.post(`/blocks/arm/move-joint?joint=${joint}&angle=${angle}`),

  resetArm: () =>
    apiClient.post('/blocks/arm/reset'),
};
