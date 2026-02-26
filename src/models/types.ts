/**
 * @module types
 *
 * Shared domain types for the Conductor extension.
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
 * Normalize user message content to a ContentBlock array.
 *
 * Real JSONL user records have two formats:
 * - Simple prompts: `content` is a plain string (e.g. `"Help me fix the bug"`)
 * - Complex (with tool results): `content` is a `ContentBlock[]`
 *
 * This helper ensures callers always get a `ContentBlock[]`.
 *
 * @param content - Raw content from a UserMessage (string, array, or undefined)
 * @returns Normalized array of ContentBlock entries
 */
export function normalizeUserContent(content: ContentBlock[] | string | undefined): ContentBlock[] {
  if (!content) return [];
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text' as const, text: content }] : [];
  }
  if (Array.isArray(content)) return content;
  return [];
}

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
  content: ContentBlock[] | string;
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
 * A system-level record such as turn duration or stop-hook summary.
 *
 * @remarks
 * - `turn_duration`: contains wall-clock time of the completed turn in `durationMs`.
 * - `stop_hook_summary`: emitted when a stop hook fires at turn end. May arrive
 *   alongside `turn_duration` (124 observed cases) or alone (63 cases).
 *   Both signal turn completion for the state machine.
 */
export interface SystemRecord extends JsonlRecordBase {
  type: 'system';
  subtype?: 'turn_duration' | 'stop_hook_summary';
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
// Conversation transcript types
// ---------------------------------------------------------------------------

/** A paired tool interaction: the call and its result. */
export interface ToolInteraction {
  toolUseId: string;
  toolName: string;
  /** Serialized + truncated tool input (string, not raw object — bounded at TRUNCATION.TOOL_INPUT_MAX). */
  inputJson: string;
  /** ~100 char summary for collapsed header display. */
  inputSummary: string;
  /** Full result text, bounded at TRUNCATION.TOOL_OUTPUT_MAX. */
  output?: string;
  isError: boolean;
  calledAt: string;
  completedAt?: string;
}

/** A single turn in the conversation transcript. */
export interface ConversationTurn {
  id: string;
  sessionId: string;
  /** Discriminator: 'user' | 'assistant' | 'system'. Named 'role' to avoid collision with JSONL 'type'. */
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  text?: string;
  tools?: ToolInteraction[];
  model?: string;
  usage?: TokenUsage;
  /** For system turns only. */
  systemEvent?: 'turn_end' | 'summary';
  durationMs?: number;
  summary?: string;
  /** For assistant turns that spawn sub-agents via Task tool. */
  subAgentSessionId?: string;
  subAgentDescription?: string;
  /** 0-based index of the continuation segment this turn belongs to (set for merged groups). */
  continuationSegmentIndex?: number;
}

// ---------------------------------------------------------------------------
// AskUserQuestion types
// ---------------------------------------------------------------------------

/** A single option within a pending AskUserQuestion prompt. */
export interface PendingQuestionOption {
  label: string;
  description: string;
}

/** A tool awaiting user approval in the terminal. */
export interface PendingToolInfo {
  toolName: string;
  /** Short summary of the tool input (e.g., "git commit -m ..."), populated by SessionTracker. */
  inputSummary: string;
}

/** Structured representation of an AskUserQuestion prompt awaiting user input. */
export interface PendingQuestion {
  question: string;
  header?: string;
  options: PendingQuestionOption[];
  multiSelect: boolean;
  /** True when waiting for plan approval (ExitPlanMode/EnterPlanMode), not a user question. */
  isPlanApproval?: boolean;
  /** Discriminator for which plan tool triggered the approval. */
  planMode?: 'enter' | 'exit';
  /** True when waiting for tool permission approval in the terminal. */
  isToolApproval?: boolean;
  /** Tools pending approval (present when isToolApproval is true). */
  pendingTools?: PendingToolInfo[];
}

// ---------------------------------------------------------------------------
// Dashboard state types
// ---------------------------------------------------------------------------

/**
 * Possible states for a monitored Claude Code session.
 *
 * @remarks
 * Six-state machine:
 * - `working` — Actively calling tools, writing code
 * - `thinking` — Generating text response, no tools yet
 * - `waiting` — Needs user input (AskUserQuestion)
 * - `error` — Stuck: 3+ tool errors in 60s window
 * - `done` — Turn completed (turn_duration received or 5s intermission)
 * - `idle` — Brief pause between turns, may continue
 */
export type SessionStatus = 'working' | 'thinking' | 'waiting' | 'error' | 'done' | 'idle';

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
  /** Whether this session is a system artifact (episodic memory, empty). Hidden by default. */
  isArtifact: boolean;
  /** Whether this session is hidden from the main view. Set by DashboardPanel. */
  isHidden?: boolean;
  /** Session ID of the parent that spawned this sub-agent. */
  parentSessionId?: string;
  /** Filesystem path of the JSONL transcript file. */
  filePath: string;
  /** User-defined display name, set via inline rename in the dashboard. */
  customName?: string;
  /** Auto-generated name from first user prompt or plan file title. */
  autoName?: string;
  /** Whether this session was launched from within Conductor (has PTY ownership). */
  launchedByConductor?: boolean;
  /** Nested sub-agent sessions spawned by this parent. */
  childAgents?: SubAgentInfo[];
  /** All member session IDs when this session is a merged continuation group (2+ members). */
  continuationSessionIds?: string[];
  /** Number of times context was cleared (members - 1). Only set for merged continuation groups. */
  continuationCount?: number;
  /** Most recent tool name (for overview display). */
  lastToolName?: string;
  /** Summarized input of the most recent tool. */
  lastToolInput?: string;
  /** Most recent assistant text message (truncated to TEXT_MAX). */
  lastAssistantText?: string;
  /** Structured question when status is 'waiting'. */
  pendingQuestion?: PendingQuestion;
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
  /** Error content when tool_result is_error (present when `type === 'tool_result'` and `isError`). */
  errorMessage?: string;
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
