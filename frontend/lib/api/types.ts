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

export enum ProjectType {
  EMBEDDED = 'embedded',
  ROS = 'ros',
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
  origin?: string;
}

export interface FileCreate {
  project_id: string;
  name: string;
  path: string;
  content: string;
  file_type: FileType;
  origin?: string;
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
  project_type: ProjectType;
  created_at: string;
  updated_at: string;
  file_count: number;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  target_compiler: CompilerType;
  project_type?: ProjectType;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  target_compiler?: CompilerType;
  project_type?: ProjectType;
}

export interface ProjectWithFiles extends ProjectResponse {
  files: FileResponse[];
}

export interface CompileRequest {
  project_id: string;
  compiler: CompilerType;
  file_ids: string[];
  main_file: string;
  build_flags?: string[];
}

export interface CompilationResponse {
  status: CompilationStatus;
  success: boolean;
  output: string;
  errors: string[];
  binary_name?: string;
  compile_time_ms: number;
  has_binary: boolean;
  hex_output?: string;
}

export interface CompileExplainRequest {
  project_id: string;
  compiler?: CompilerType;
  logs: string;
  errors?: string[];
}

export interface CompileExplainResponse {
  explanation: string;
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
  plan_mode?: boolean;
  enable_websearch?: boolean;
}

export interface ChatResponse {
  message: string;
  file_operations: Array<{
    operation: string;
    path: string;
    file_id?: string;
    success?: boolean;
    content?: string;
  }>;
}

export interface StepExecutionRequest {
  step_title: string;
  step_body: string;
  workspace_id?: string;
  file_context?: FileContext[];
  compiler?: string;
  enable_websearch?: boolean;
}

export interface ExecutionLogEntry {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  success: boolean;
}

export interface StepExecutionResponse {
  message: string;
  file_operations: Array<{
    operation: string;
    path: string;
    file_id?: string;
    success?: boolean;
  }>;
  execution_logs: ExecutionLogEntry[];
  success: boolean;
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

// Wiring
export interface WiringConnectionDTO {
  from: string;
  to: string;
  color: string;
  note: string;
}

export interface DetectedComponentDTO {
  name: string;
  type: string;
  connections: WiringConnectionDTO[];
  notes: string[];
  pins: string[];
}

export interface WiringGuideDTO {
  components: DetectedComponentDTO[];
  power: WiringConnectionDTO[];
  warnings: string[];
  summary: string;
  explanation?: string;
}

export interface WiringRequest {
  source_code: string;
  compiler?: string;
}

export interface WiringResponse {
  guide: WiringGuideDTO;
  llm_generated: boolean;
}

// CAD — Plan types
export interface CadPlanStep {
  id: string;
  name: string;
  filename: string;
  description: string;
  dependencies: string[];
  approach_hint: string;
}

export type CadSSEEventType =
  | 'planning'
  | 'plan_ready'
  | 'executing_part'
  | 'reflecting'
  | 'part_result'
  | 'complete'
  | 'error';

export interface CadSSEEvent {
  type: CadSSEEventType;
  message?: string;
  parts?: CadPlanStep[];
  part_id?: string;
  part_index?: number;
  total?: number;
  attempt?: number;
  error?: string;
  success?: boolean;
  stl_base64?: string;
  cadquery_code?: string;
  attempts?: number;
}

export interface PlanStepState extends CadPlanStep {
  status: 'pending' | 'running' | 'success' | 'failed';
  attempts?: number;
  stl_base64?: string;
  error?: string;
}

// CAD
export interface CadChatRequest {
  message: string;
  conversation_history?: Array<{ role: string; content: string }>;
  current_code?: string;
}

export interface CadChatResponse {
  message: string;
  cadquery_code?: string | null;
  stl_base64?: string | null;
  error?: string | null;
}

export interface CadSessionHistory {
  messages: Array<{
    role: string;
    content: string;
    cadquery_code?: string | null;
    has_model?: boolean;
  }>;
  current_code?: string | null;
}
