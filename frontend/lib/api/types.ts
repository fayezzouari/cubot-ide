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
  user_id?: string;
  mission_id?: string | null;
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
  /** Full path of the file open in the editor, so the agent knows what the user is looking at. */
  active_file_path?: string;
  compiler?: string;
  conversation_history?: Array<{ role: string; content: string }>;
  plan_mode?: boolean;
  tutor_mode?: boolean;
  enable_websearch?: boolean;
  /** Sandbox workspace (ROS projects) the agent may run commands in. */
  workspace_id?: string;
  /** Conversation to append to; omitted starts a new one. */
  thread_id?: string;
}

/** One conversation inside a project. */
export interface ThreadSummary {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/** One file the agent created or changed during a turn. `previous_content` is null for created files. */
export interface FileOperation {
  operation: 'create_file' | 'edit_file' | 'update_file' | string;
  path: string;
  file_id?: string;
  summary?: string;
  added?: number;
  removed?: number;
  previous_content?: string | null;
  success?: boolean;
}

export interface ExecutionLogEntry {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  success: boolean;
}

export interface ChatResponse {
  message: string;
  file_operations: FileOperation[];
  execution_logs?: ExecutionLogEntry[];
  thread_id?: string;
}

/** Server-sent events emitted by `POST /chat/{project}/stream`. */
export type AgentEvent =
  | { type: 'status'; text: string }
  /** The conversation this turn is saved in (sent first; new when none was given). */
  | { type: 'thread'; thread_id: string }
  /** A piece of the assistant's answer, in order; concatenate to build the message. */
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; tool: string; label: string; detail: string }
  | {
      type: 'tool_end';
      id: string;
      tool: string;
      label: string;
      detail: string;
      ok: boolean;
      summary: string;
      file_op: FileOperation | null;
      log: ExecutionLogEntry | null;
    }
  | { type: 'done'; message: string; file_operations: FileOperation[]; execution_logs: ExecutionLogEntry[] }
  | { type: 'error'; message: string };

export interface StepExecutionRequest {
  step_title: string;
  step_body: string;
  workspace_id?: string;
  file_context?: FileContext[];
  active_file_path?: string;
  compiler?: string;
  enable_websearch?: boolean;
}

export interface StepExecutionResponse {
  message: string;
  file_operations: FileOperation[];
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
  file_operations: FileOperation[];
  mode?: 'build' | 'plan' | 'tutor' | null;
  thread_id?: string | null;
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

export type MissionStatus = 'new' | 'started' | 'passed';

export interface MissionSummary {
  id: string;
  order: number;
  track: string;
  title: string;
  summary: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  concepts: string[];
  status: MissionStatus;
  project_id?: string | null;
}

export interface MissionCheck {
  id: string;
  label: string;
  type: 'pin_toggles' | 'pin_state' | 'serial_contains';
}

export interface Mission extends MissionSummary {
  brief: string;
  goal: string;
  duration_ms: number;
  starter_files: Array<{ path: string; content: string }>;
  checks: MissionCheck[];
  hints: string[];
}

export interface MissionCheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface MissionRun {
  mission_id: string;
  passed: boolean;
  results: MissionCheckResult[];
  serial: string;
  duration_ms: number;
  sim_clock: boolean;
  error?: string | null;
}

export interface MissionStart {
  project_id: string;
  created: boolean;
}
