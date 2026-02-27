/**
 * @module sharedConstants
 *
 * Constants shared between the extension backend and webview frontend.
 * Extension code imports directly; webview uses the `@shared/sharedConstants` alias.
 *
 * @remarks
 * All values use `as const` to preserve literal types for TypeScript narrowing.
 */

import type { SessionStatus } from './types';

// ---------------------------------------------------------------------------
// Content block type discriminators
// ---------------------------------------------------------------------------

/** Content block type discriminators within assistant/user messages. */
export const CONTENT_BLOCK_TYPES = {
  TEXT: 'text',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
} as const;

// ---------------------------------------------------------------------------
// JSONL record type discriminators
// ---------------------------------------------------------------------------

/** JSONL record type discriminators for the top-level `type` field. */
export const RECORD_TYPES = {
  ASSISTANT: 'assistant',
  USER: 'user',
  SYSTEM: 'system',
  SUMMARY: 'summary',
  PROGRESS: 'progress',
  QUEUE_OPERATION: 'queue-operation',
  FILE_HISTORY_SNAPSHOT: 'file-history-snapshot',
} as const;

// ---------------------------------------------------------------------------
// Session status values
// ---------------------------------------------------------------------------

/** Session status values for the six-state machine. */
export const SESSION_STATUSES = {
  WORKING: 'working',
  THINKING: 'thinking',
  WAITING: 'waiting',
  ERROR: 'error',
  DONE: 'done',
  IDLE: 'idle',
} as const;

// ---------------------------------------------------------------------------
// Activity event type discriminators
// ---------------------------------------------------------------------------

/** Activity event type discriminators for the dashboard feed. */
export const ACTIVITY_TYPES = {
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  TEXT: 'text',
  TURN_END: 'turn_end',
  USER_INPUT: 'user_input',
} as const;

// ---------------------------------------------------------------------------
// Conversation turn roles & system events
// ---------------------------------------------------------------------------

/** Conversation turn role discriminators. */
export const CONVERSATION_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const;

/** System event subtypes within ConversationTurn. */
export const SYSTEM_EVENTS = {
  TURN_END: 'turn_end',
  SUMMARY: 'summary',
} as const;

// ---------------------------------------------------------------------------
// Session status groups (common filtering patterns)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input values for terminal responses
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Launch mode discriminators
// ---------------------------------------------------------------------------

/** Launch mode discriminators for the split button session launcher. */
export const LAUNCH_MODES = {
  NORMAL: 'normal',
  YOLO: 'yolo',
  REMOTE: 'remote',
} as const;

/** Union type of all launch mode string literals. */
export type LaunchMode = (typeof LAUNCH_MODES)[keyof typeof LAUNCH_MODES];

// ---------------------------------------------------------------------------
// Input values for terminal responses
// ---------------------------------------------------------------------------

/** Terminal input values for tool approval responses. */
export const TOOL_APPROVAL_INPUTS = {
  ALLOW: '1',
  ALLOW_ALWAYS: '2',
  DENY: '3',
} as const;

/** Terminal input values for plan mode responses. */
export const PLAN_INPUTS = {
  YES: 'yes',
  NO: 'no',
} as const;

// ---------------------------------------------------------------------------
// Session status groups (common filtering patterns)
// ---------------------------------------------------------------------------

/** Reusable session status groupings for filtering and comparison. */
export const STATUS_GROUPS = {
  /** Statuses indicating active AI work (tool calls or text generation). */
  ACTIVE: new Set<SessionStatus>([SESSION_STATUSES.WORKING, SESSION_STATUSES.THINKING]),
  /** Statuses indicating the turn is finished. */
  COMPLETED: new Set<SessionStatus>([SESSION_STATUSES.DONE, SESSION_STATUSES.IDLE]),
  /** Statuses where the session is ready for user input. */
  READY_FOR_INPUT: new Set<SessionStatus>([
    SESSION_STATUSES.WAITING,
    SESSION_STATUSES.DONE,
    SESSION_STATUSES.IDLE,
  ]),
  /** Statuses included in the "active" dashboard filter. */
  ACTIVE_FILTER: new Set<SessionStatus>([
    SESSION_STATUSES.WORKING,
    SESSION_STATUSES.THINKING,
    SESSION_STATUSES.WAITING,
  ]),
} as const;

// ---------------------------------------------------------------------------
// Spatial navigation directions
// ---------------------------------------------------------------------------

/** Spatial navigation directions for keyboard nav. */
export const NAV_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
} as const;

/** Spatial navigation direction for keyboard-driven card focus. */
export type NavDirection = (typeof NAV_DIRECTIONS)[keyof typeof NAV_DIRECTIONS];

// ---------------------------------------------------------------------------
// Overview panel display modes
// ---------------------------------------------------------------------------

/** Overview panel display mode discriminators (list vs kanban board). */
export const OVERVIEW_MODES = {
  LIST: 'list',
  BOARD: 'board',
} as const;

/** Union type of all overview mode string literals. */
export type OverviewMode = (typeof OVERVIEW_MODES)[keyof typeof OVERVIEW_MODES];

// ---------------------------------------------------------------------------
// Kanban column sort directions
// ---------------------------------------------------------------------------

/** Kanban column sort direction discriminators. */
export const SORT_DIRECTIONS = {
  DESC: 'desc',
  ASC: 'asc',
} as const;

/** Union type of all sort direction string literals. */
export type SortDirection = (typeof SORT_DIRECTIONS)[keyof typeof SORT_DIRECTIONS];

// ---------------------------------------------------------------------------
// Terminal key escape sequences
// ---------------------------------------------------------------------------

/** Escape sequences for terminal key forwarding (used by both extension and webview). */
export const TERMINAL_KEYS = {
  /** CSI u encoded Shift+Enter for multi-line input in Claude Code. */
  SHIFT_ENTER: '\x1b[13;2u',
  /** Ctrl+U: kill to beginning of line (maps Cmd+Backspace on macOS, Ctrl+Backspace on Win/Linux). */
  CMD_BACKSPACE: '\x15',
} as const;
