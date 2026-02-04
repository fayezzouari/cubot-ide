// API Types matching backend models

export enum FileType {
  C = 'c',
  CPP = 'cpp',
  H = 'h',
  HPP = 'hpp',
  INO = 'ino',
  PY = 'py',
  TXT = 'txt',
  MD = 'md',
  JSON = 'json',
  MAKEFILE = 'makefile',
  OTHER = 'other',
}

export enum CompilerType {
  ARDUINO = 'arduino',
  TI_ARM = 'ti_arm',
  ESP32 = 'esp32',
}

export enum CompilationStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  TIMEOUT = 'timeout',
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export interface FileResponse {
  id: string;
  project_id: string;
  name: string;
  path: string;
  content: string;
  file_type: FileType;
  created_at: string;
  updated_at: string;
}

export interface FileCreate {
  project_id: string;
  name: string;
  path: string;
  content: string;
  file_type: FileType;
}

export interface FileUpdate {
  name?: string;
  path?: string;
  content?: string;
  file_type?: FileType;
}

export interface ProjectResponse {
  id: string;
  name: string;
  description: string;
  target_compiler: string;
  created_at: string;
  updated_at: string;
  file_count: number;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  target_compiler: CompilerType;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  target_compiler?: CompilerType;
}

export interface ProjectWithFiles extends ProjectResponse {
  files: FileResponse[];
}

export interface CompileRequest {
  compiler: CompilerType;
  file_ids: string[];
  main_file: string;
  build_flags?: string[];
}

export interface CompilationResponse {
  status: CompilationStatus;
  output: string;
  errors: string[];
  binary_name?: string;
  compile_time_ms: number;
  has_binary: boolean;
}

export interface FileContext {
  path: string;
  content: string;
}

export interface ChatRequest {
  message: string;
  file_context?: FileContext[];
  compiler?: string;
  conversation_history?: Array<{ role: string; content: string }>;
}

export interface ChatResponse {
  message: string;
  file_operations: Array<{
    operation: string;
    path: string;
    content?: string;
  }>;
}

export interface ChatMessageInDB {
  id: string;
  project_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  file_context: FileContext[];
  file_operations: any[];
}
