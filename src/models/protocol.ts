/**
 * @module protocol
 *
 * IPC message contracts between the extension backend and the webview frontend.
 *
 * @remarks
 * All messages are serialized as JSON via `postMessage()`. The extension sends
 * {@link ExtensionToWebviewMessage} to the webview, and the webview sends
 * {@link WebviewToExtensionMessage} back. Both are discriminated unions keyed on `type`.
 *
 * **Rule:** Every IPC message type must be defined here. No ad-hoc message shapes
 * elsewhere in the codebase.
 */

import { SessionInfo, ActivityEvent, ToolStatEntry, TokenSummary } from './types';

/**
 * Messages sent from the extension backend to the webview.
 *
 * @remarks
 * - `sessions:update` — Full session list refresh, sent on every state change.
 * - `activity:full` — Complete activity feed snapshot (last 200 events).
 * - `toolStats:update` — Aggregated tool usage statistics across all sessions.
 * - `tokens:update` — Per-session token summaries with cost estimates.
 */
export type ExtensionToWebviewMessage =
  | { type: 'sessions:update'; sessions: SessionInfo[] }
  | { type: 'activity:full'; events: ActivityEvent[] }
  | { type: 'toolStats:update'; stats: ToolStatEntry[] }
  | { type: 'tokens:update'; tokenSummaries: TokenSummary[] };

/**
 * Messages sent from the webview to the extension backend.
 *
 * @remarks
 * - `ready` — Webview has mounted and is requesting initial state.
 * - `session:focus` — User selected a session; extension filters activity feed.
 * - `refresh` — User clicked refresh; extension re-scans for session files.
 */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'session:focus'; sessionId: string | null }
  | { type: 'refresh' }
  /** Sent when the user renames a session via inline edit in the overview card. */
  | { type: 'session:rename'; sessionId: string; name: string };
