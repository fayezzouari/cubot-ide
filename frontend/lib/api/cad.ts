import { apiClient, ApiError } from './client';
import { authHeaders } from './auth-header';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export type Vec3 = [number, number, number];

export interface CadParam {
  default: number | boolean;
  value: number | boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string;
}

export interface CadPort {
  origin: Vec3;
  axis: Vec3;
  ref: Vec3 | null;
}

export interface CadVersion {
  id: string;
  number: number;
  key: string;
  prompt: string | null;
  params: Record<string, CadParam>;
  ports?: Record<string, CadPort>;
  bbox: { min: Vec3; max: Vec3; size: Vec3 } | null;
  volume: number | null;
  valid: boolean | null;
  solids: number | null;
  faces: number | null;
  created_at: string | null;
  code?: string;
}

export interface CadPart {
  id: string;
  name: string;
  source: 'generated' | 'imported';
  kind: 'brep' | 'mesh';
  color: string;
  version: CadVersion | null;
}

export interface CadInstance {
  id: string;
  part_id: string;
  name: string;
  position: Vec3;
  rotation: Vec3; // degrees, Euler XYZ, CAD frame (Z up)
  color: string | null;
  visible: boolean;
  /** How the copy is placed: mated port to port, attached to a face, or neither (placed by hand). */
  mate?: { port: string; to: string; to_port: string; gap: number; angle: number } | null;
  attach?: Record<string, unknown> | null;
}

export interface CadAssembly {
  name: string;
  instances: CadInstance[];
}

export interface CadState {
  parts: CadPart[];
  assembly: CadAssembly;
}

export interface FaceInfo {
  id: number;
  start: number;
  count: number;
  type: string;
  center: Vec3;
  normal: Vec3 | null;
  area: number;
}

export interface PartMesh {
  positions: number[];
  normals: number[];
  indices: number[];
  faces: FaceInfo[];
}

export type CadEvent =
  | { type: 'planning' }
  | {
      type: 'plan';
      name: string;
      summary?: string;
      interfaces?: Record<string, number | string>;
      parts: { id: string; name: string; description: string; features?: string[]; count: number }[];
    }
  | { type: 'agent'; plan_id?: string; part_id?: string; action: 'build' | 'error' | 'view' | 'finish'; detail: string }
  | { type: 'part_started'; plan_id?: string; part_id?: string }
  | { type: 'part_retry'; plan_id?: string; part_id?: string; attempt: number; error: string }
  | { type: 'part_failed'; plan_id: string; error: string }
  | { type: 'part_done'; plan_id?: string; part_id?: string; part: CadPart; instances?: CadInstance[] }
  | { type: 'state'; state: CadState }
  | { type: 'reviewing'; round: number }
  | { type: 'review'; round: number; ok: boolean; issues: string[]; fixed: number; note?: string }
  | { type: 'message'; message: CadMessage }
  | { type: 'complete'; state: CadState }
  | { type: 'error'; message: string };

export interface CadSnapshot {
  id: string;
  label: string;
  auto: boolean;
  created_at: string;
  copies: number;
  parts: number;
}

export interface TrashedPart extends CadPart {
  deleted_at: string | null;
  copies: number;
}

export interface CadMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  data: Record<string, unknown>;
  created_at: string;
}

export type ExportFormat = 'step' | 'stl' | '3mf' | 'glb' | 'stl-zip' | 'urdf';

async function request(method: string, endpoint: string, body?: BodyInit, json = true): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: { ...(json && body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    body,
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {}
    throw new ApiError(response.status, message);
  }
  return response;
}

async function stream(endpoint: string, body: unknown, onEvent: (e: CadEvent) => void, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = response.statusText;
    try {
      message = (await response.json()).detail || message;
    } catch {}
    throw new ApiError(response.status, message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        onEvent(JSON.parse(payload));
      } catch {}
    }
  }
}

// Built files never change for a given key, so meshes are cached for the session.
const meshCache = new Map<string, Promise<PartMesh>>();

export const cadApi = {
  state: (projectId: string) => apiClient.get<CadState>(`/cad/${projectId}`),

  /** `viewImage`: a screenshot of the viewport (data URL) so the AI sees what the user sees. */
  generate: (projectId: string, prompt: string, onEvent: (e: CadEvent) => void, signal?: AbortSignal,
             viewImage?: string | null) =>
    stream(`/cad/${projectId}/generate`, { prompt, view_image: viewImage ?? null }, onEvent, signal),

  edit: (
    projectId: string,
    partId: string,
    instruction: string,
    face: Omit<FaceInfo, 'start' | 'count'> | null,
    onEvent: (e: CadEvent) => void,
    signal?: AbortSignal,
    viewImage?: string | null,
  ) =>
    stream(`/cad/${projectId}/parts/${partId}/edit`, { instruction, face, view_image: viewImage ?? null }, onEvent, signal),

  setParams: (projectId: string, partId: string, params: Record<string, number | boolean>) =>
    apiClient.post<CadPart>(`/cad/${projectId}/parts/${partId}/params`, { params }),

  setCode: (projectId: string, partId: string, code: string) =>
    apiClient.put<CadPart>(`/cad/${projectId}/parts/${partId}/code`, { code }),

  versions: (projectId: string, partId: string) =>
    apiClient.get<CadVersion[]>(`/cad/${projectId}/parts/${partId}/versions`),

  revert: (projectId: string, partId: string, versionId: string) =>
    apiClient.post<CadPart>(`/cad/${projectId}/parts/${partId}/revert`, { version_id: versionId }),

  duplicate: (projectId: string, partId: string) =>
    apiClient.post<CadPart>(`/cad/${projectId}/parts/${partId}/duplicate`),

  updatePart: async (projectId: string, partId: string, fields: { name?: string; color?: string }) => {
    await request('PATCH', `/cad/${projectId}/parts/${partId}`, JSON.stringify(fields));
  },

  deletePart: (projectId: string, partId: string) => apiClient.delete<void>(`/cad/${projectId}/parts/${partId}`),

  saveAssembly: (projectId: string, assembly: CadAssembly) =>
    apiClient.put<CadAssembly>(`/cad/${projectId}/assembly`, assembly),

  importFile: async (projectId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await request('POST', `/cad/${projectId}/import`, form, false);
    return (await res.json()) as { part: CadPart; instance: CadInstance };
  },

  export: async (projectId: string, format: ExportFormat, instanceIds?: string[]) => {
    const res = await request(
      'POST',
      `/cad/${projectId}/export`,
      JSON.stringify({ format, instance_ids: instanceIds ?? null }),
    );
    const disposition = res.headers.get('content-disposition') || '';
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] || `assembly.${format}`;
    return { blob: await res.blob(), name };
  },

  messages: (projectId: string) => apiClient.get<CadMessage[]>(`/cad/${projectId}/messages`),

  clearMessages: (projectId: string) => apiClient.delete<void>(`/cad/${projectId}/messages`),

  snapshots: (projectId: string) => apiClient.get<CadSnapshot[]>(`/cad/${projectId}/snapshots`),

  saveSnapshot: (projectId: string, label: string) =>
    apiClient.post<CadSnapshot>(`/cad/${projectId}/snapshots`, { label }),

  restoreSnapshot: (projectId: string, snapshotId: string) =>
    apiClient.post<CadState>(`/cad/${projectId}/snapshots/${snapshotId}/restore`),

  deleteSnapshot: (projectId: string, snapshotId: string) =>
    apiClient.delete<void>(`/cad/${projectId}/snapshots/${snapshotId}`),

  trash: (projectId: string) => apiClient.get<TrashedPart[]>(`/cad/${projectId}/trash`),

  restorePart: (projectId: string, partId: string) =>
    apiClient.post<{ part: CadPart; instances: CadInstance[] }>(`/cad/${projectId}/parts/${partId}/restore`),

  mesh: (key: string): Promise<PartMesh> => {
    let cached = meshCache.get(key);
    if (!cached) {
      cached = request('GET', `/cad/files/${key}/mesh.json`).then((r) => r.json());
      cached.catch(() => meshCache.delete(key));
      meshCache.set(key, cached);
    }
    return cached;
  },

  partFile: async (key: string, name: 'part.step' | 'part.stl') =>
    (await request('GET', `/cad/files/${key}/${name}`)).blob(),
};
