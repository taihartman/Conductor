/**
 * @module types
 *
 * Shared domain types for the Claude Agent Dashboard extension.
 * These types are the single source of truth used by both the extension backend
 * and the webview frontend. Never duplicate these in `webview-ui/`.
 */

/**
 * Discriminator for all JSONL record types emitted by Claude Code transcripts.
 *
 * @remarks
 * Each value maps to a concrete record interface (e.g., `'assistant'` maps to {@link AssistantRecord}).
 * The `'queue-operation'` and `'file-history-snapshot'` types are consumed silently with no UI impact.
 */
export type JsonlRecordType =
  | 'assistant'
  | 'user'
  | 'system'
  | 'progress'
  | 'summary'
  | 'queue-operation'
  | 'file-history-snapshot';

/**
 * Common fields present on all JSONL transcript records.
 *
 * @remarks
 * Not all fields are populated on every record — presence depends on the record type
 * and the Claude Code version that produced the transcript. Fields like `sessionId` and
 * `slug` may appear on any record and are used by {@link SessionTracker} to update
 * session metadata.
 */
export interface JsonlRecordBase {
  /** Discriminator identifying the record type. */
  type: JsonlRecordType;
  /** UUID of the parent message in a conversation thread. */
  parentUuid?: string;
  /** Whether this record belongs to a sidechain (branched conversation). */
  isSidechain?: boolean;
  /** The type of user interaction (e.g., `'human_turn'`). */
  userType?: string;
  /** Working directory of the Claude Code session when this record was emitted. */
  cwd?: string;
  /** Session identifier linking records to a specific Claude Code session. */
  sessionId?: string;
  /** Claude Code CLI version that produced this record. */
  version?: string;
  /** Git branch active in the session's working directory. */
  gitBranch?: string;
  /** Short human-readable session slug (first 8 chars of session UUID). */
  slug?: string;
  /** Unique identifier for this specific record. */
  uuid?: string;
  /** ISO 8601 timestamp of when the record was created. */
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Content block types within messages
// ---------------------------------------------------------------------------

/** A plain text content block within an assistant or user message. */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** A tool invocation content block emitted by the assistant. */
export interface ToolUseContentBlock {
  type: 'tool_use';
  /** Unique ID used to correlate with the corresponding {@link ToolResultContentBlock}. */
  id: string;
  /** Name of the tool being invoked (e.g., `'Read'`, `'Bash'`, `'Grep'`). */
  name: string;
  /** Tool-specific input parameters. */
  input: Record<string, unknown>;
}

/** The result of a tool invocation, returned by the user turn. */
export interface ToolResultContentBlock {
  type: 'tool_result';
  /** ID of the {@link ToolUseContentBlock} this result corresponds to. */
  tool_use_id: string;
  /** Tool output — either a plain string or an array of typed content blocks. */
  content?: string | Array<{ type: string; text?: string }>;
  /** Whether the tool execution resulted in an error. */
  is_error?: boolean;
}

/**
 * Discriminated union of all content block types that can appear
 * within assistant and user messages.
 */
export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

/**
 * Token usage counters from an assistant message's API response.
 *
 * @remarks
 * Mirrors the `usage` object from the Anthropic Messages API. Cache-related fields
 * are optional and only present when prompt caching is active.
 */
export interface TokenUsage {
  /** Number of input tokens consumed (excluding cache reads). */
  input_tokens: number;
  /** Number of output tokens generated. */
  output_tokens: number;
  /** Tokens written to prompt cache in this request. */
  cache_creation_input_tokens?: number;
  /** Tokens read from prompt cache instead of being re-processed. */
  cache_read_input_tokens?: number;
  /** Breakdown of ephemeral cache creation by TTL tier. */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  /** Server-side tool usage counts (web search, web fetch). */
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
  /** API service tier used for this request. */
  service_tier?: string;
}

/** The inner message payload of an {@link AssistantRecord}. */
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

/** The inner message payload of a {@link UserRecord}. */
export interface UserMessage {
  role: 'user';
  content: ContentBlock[];
}

// ---------------------------------------------------------------------------
// JSONL record types (discriminated union)
// ---------------------------------------------------------------------------

/** An assistant turn containing the model's response, tool calls, and token usage. */
export interface AssistantRecord extends JsonlRecordBase {
  type: 'assistant';
  message: AssistantMessage;
}

/** A user turn containing tool results and/or user-provided text input. */
export interface UserRecord extends JsonlRecordBase {
  type: 'user';
  message: UserMessage;
}

/**
 * A system-level record such as turn duration measurement.
 *
 * @remarks
 * When `subtype` is `'turn_duration'`, the `durationMs` field contains the total
 * wall-clock time of the completed turn. This triggers an idle transition in the
 * session state machine.
 */
export interface SystemRecord extends JsonlRecordBase {
  type: 'system';
  subtype?: 'turn_duration';
  /** Wall-clock duration of the turn in milliseconds. */
  durationMs?: number;
}

/** An intermediate progress update emitted during long-running operations. */
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

/** A conversation summary record, typically emitted after context compression. */
export interface SummaryRecord extends JsonlRecordBase {
  type: 'summary';
  summary?: string;
  message?: {
    content: string | ContentBlock[];
  };
}

/** A queue operation record (e.g., task queuing). Consumed silently — no UI impact. */
export interface QueueOperationRecord extends JsonlRecordBase {
  type: 'queue-operation';
  operation?: string;
}

/** A file history snapshot for undo/redo tracking. Consumed silently — no UI impact. */
export interface FileHistorySnapshotRecord extends JsonlRecordBase {
  type: 'file-history-snapshot';
  messageId?: string;
  snapshot?: {
    trackedFileBackups?: Record<string, unknown>;
  };
  isSnapshotUpdate?: boolean;
}

/**
 * Discriminated union of all JSONL record types.
 *
 * @remarks
 * Use the `type` field to narrow to a specific record interface.
 * The {@link SessionTracker} processes these via a switch on `record.type`.
 */
export type JsonlRecord =
  | AssistantRecord
  | UserRecord
  | SystemRecord
  | ProgressRecord
  | SummaryRecord
  | QueueOperationRecord
  | FileHistorySnapshotRecord;

// ---------------------------------------------------------------------------
// Dashboard state types
// ---------------------------------------------------------------------------

/**
 * Possible states for a monitored Claude Code session.
 *
 * @remarks
 * State transitions: `idle` → `active` (on user input or tool call) → `waiting`
 * (on `AskUserQuestion` tool) → `active` (on user response) → `idle` (on turn end
 * or {@link IDLE_TIMEOUT_MS} expiry).
 */
export type SessionStatus = 'active' | 'idle' | 'waiting';

/** Summary info for a sub-agent spawned by a parent session. */
export interface SubAgentInfo {
  sessionId: string;
  slug: string;
  status: SessionStatus;
  /** First user prompt or slug — describes the sub-agent's purpose. */
  description: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastActivityAt: string;
}

/**
 * Complete metadata for a monitored Claude Code session.
 *
 * @remarks
 * Maintained by {@link SessionTracker} and sent to the webview via the
 * `sessions:update` IPC message. Sub-agent sessions have `isSubAgent: true`
 * and optionally reference their parent via `parentSessionId`.
 */
export interface SessionInfo {
  sessionId: string;
  /** Short human-readable identifier (first 8 chars of session UUID). */
  slug: string;
  /** Conversation summary, populated from {@link SummaryRecord} entries. */
  summary: string;
  status: SessionStatus;
  /** Model ID used in the most recent assistant turn. */
  model: string;
  gitBranch: string;
  /** Working directory of the Claude Code session. */
  cwd: string;
  /** ISO 8601 timestamp of session creation. */
  startedAt: string;
  /** ISO 8601 timestamp of the most recent record. */
  lastActivityAt: string;
  /** Number of completed assistant turns. */
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  /** Whether this session was spawned as a sub-agent (Task tool). */
  isSubAgent: boolean;
  /** Session ID of the parent that spawned this sub-agent. */
  parentSessionId?: string;
  /** Filesystem path of the JSONL transcript file. */
  filePath: string;
  /** Nested sub-agent sessions spawned by this parent. */
  childAgents?: SubAgentInfo[];
}

/**
 * A single activity event displayed in the dashboard activity feed.
 *
 * @remarks
 * Events are generated by {@link SessionTracker} as it processes JSONL records.
 * The `type` discriminator determines which optional fields are populated:
 * - `tool_call`: `toolName`, `toolInput`
 * - `tool_result`: `isError`
 * - `text`: `text`
 * - `turn_end`: `durationMs`
 * - `user_input`: `text`
 */
export interface ActivityEvent {
  /** Monotonically increasing event ID (e.g., `'evt-42'`). */
  id: string;
  sessionId: string;
  sessionSlug: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'text' | 'turn_end' | 'user_input';
  /** Name of the tool invoked (present when `type === 'tool_call'`). */
  toolName?: string;
  /** Summarized tool input, truncated to ~100 chars (present when `type === 'tool_call'`). */
  toolInput?: string;
  /** Text content from assistant or user (present when `type === 'text' | 'user_input'`). */
  text?: string;
  /** Whether the tool result was an error (present when `type === 'tool_result'`). */
  isError?: boolean;
  /** Turn duration in ms (present when `type === 'turn_end'`). */
  durationMs?: number;
}

/**
 * Aggregated statistics for a single tool across all sessions.
 *
 * @remarks
 * Maintained by {@link ToolStats} and sent to the webview via the `toolStats:update` message.
 */
export interface ToolStatEntry {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  /** Average duration per call in milliseconds (`totalDurationMs / callCount`). */
  avgDurationMs: number;
}

/**
 * Per-session token usage summary with estimated USD cost.
 *
 * @remarks
 * Computed by {@link TokenCounter} using hardcoded model pricing. Sent to the
 * webview via the `tokens:update` IPC message.
 */
export interface TokenSummary {
  sessionId: string;
  sessionSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Estimated cost in USD, rounded to 4 decimal places. */
  estimatedCostUsd: number;
}
