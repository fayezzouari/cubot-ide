import { authHeaders } from './auth-header'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    let errorMessage = response.statusText;

    try {
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || JSON.stringify(errorData);
      } else {
        errorMessage = await response.text();
      }
    } catch (e) {
      // If we can't parse the error, just use the status text
    }

    const error = new ApiError(response.status, errorMessage);
    (error as any).response = { status: response.status, data: { detail: errorMessage } };
    throw error;
  }

  // For 204 No Content responses, return null/undefined
  if (response.status === 204) {
    return null as any;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  return response.text() as any;
}


/**
 * POST and read a server-sent event stream. Each `data:` line is parsed as JSON and
 * handed to `onEvent`; the stream ends on `[DONE]` or when the body closes.
 */
async function streamEvents<T>(
  endpoint: string,
  data: unknown,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...await authHeaders(),
    },
    body: JSON.stringify(data ?? {}),
    signal,
  });
  if (!response.ok || !response.body) {
    await handleResponse(response);
    throw new ApiError(response.status, 'Empty stream');
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
        onEvent(JSON.parse(payload) as T);
      } catch {
        // a malformed frame is dropped; the next one carries the state
      }
    }
  }
}

export const apiClient = {
  stream: streamEvents,

  get: async <T>(endpoint: string): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...await authHeaders(),
      },
    });
    return handleResponse<T>(response);
  },

  post: async <T>(endpoint: string, data?: any): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...await authHeaders(),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  put: async <T>(endpoint: string, data?: any): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...await authHeaders(),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  delete: async <T>(endpoint: string): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...await authHeaders(),
      },
    });
    return handleResponse<T>(response);
  },

  download: async (endpoint: string): Promise<Blob> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...await authHeaders(),
      },
    });

    if (!response.ok) {
      throw new ApiError(response.status, response.statusText);
    }

    return response.blob();
  },
};
