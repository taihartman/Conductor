// JSONL record types from Claude Code transcripts

export type JsonlRecordType =
  | 'assistant'
  | 'user'
  | 'system'
  | 'progress'
  | 'summary'
  | 'queue-operation'
  | 'file-history-snapshot';

export interface JsonlRecordBase {
  type: JsonlRecordType;
  parentUuid?: string;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  uuid?: string;
  timestamp?: string;
}

// Content block types within messages
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock;

// Token usage from assistant messages
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
  service_tier?: string;
}

// Message structure within assistant/user records
export interface AssistantMessage {
  model: string;
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: TokenUsage;
}

export interface UserMessage {
  role: 'user';
  content: ContentBlock[];
}

// Record types
export interface AssistantRecord extends JsonlRecordBase {
  type: 'assistant';
  message: AssistantMessage;
}

export interface UserRecord extends JsonlRecordBase {
  type: 'user';
  message: UserMessage;
}

export interface SystemRecord extends JsonlRecordBase {
  type: 'system';
  subtype?: 'turn_duration';
  durationMs?: number;
}

export interface ProgressRecord extends JsonlRecordBase {
  type: 'progress';
  data?: {
    type?: string;
    [key: string]: unknown;
  };
  message?: {
    role: string;
    content: ContentBlock[];
  };
}

export interface SummaryRecord extends JsonlRecordBase {
  type: 'summary';
  summary?: string;
  message?: {
    content: string | ContentBlock[];
  };
}

export interface QueueOperationRecord extends JsonlRecordBase {
  type: 'queue-operation';
  operation?: string;
}

export interface FileHistorySnapshotRecord extends JsonlRecordBase {
  type: 'file-history-snapshot';
  messageId?: string;
  snapshot?: {
    trackedFileBackups?: Record<string, unknown>;
  };
  isSnapshotUpdate?: boolean;
}

export type JsonlRecord =
  | AssistantRecord
  | UserRecord
  | SystemRecord
  | ProgressRecord
  | SummaryRecord
  | QueueOperationRecord
  | FileHistorySnapshotRecord;

// Dashboard state types
export type SessionStatus = 'active' | 'idle' | 'waiting';

export interface SessionInfo {
  sessionId: string;
  slug: string;
  summary: string;
  status: SessionStatus;
  model: string;
  gitBranch: string;
  cwd: string;
  startedAt: string;
  lastActivityAt: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  isSubAgent: boolean;
  parentSessionId?: string;
  filePath: string;
}

export interface ActivityEvent {
  id: string;
  sessionId: string;
  sessionSlug: string;
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'text' | 'turn_end' | 'user_input';
  toolName?: string;
  toolInput?: string;
  text?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface ToolStatEntry {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface TokenSummary {
  sessionId: string;
  sessionSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number;
}
