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

import { SessionInfo, ActivityEvent, ConversationTurn, ToolStatEntry, TokenSummary } from './types';

/**
 * Messages sent from the extension backend to the webview.
 *
 * @remarks
 * - `state:full` — Atomic snapshot of all dashboard state. Sent on state changes and `ready`.
 * - `activity:full` — Activity feed for the focused session. Sent on `session:focus`.
 * - `conversation:full` — Conversation transcript for the focused session. Sent on `session:focus`.
 */
export type ExtensionToWebviewMessage =
  | {
      type: 'state:full';
      sessions: SessionInfo[];
      activities: ActivityEvent[];
      conversation: ConversationTurn[];
      toolStats: ToolStatEntry[];
      tokenSummaries: TokenSummary[];
    }
  | { type: 'activity:full'; events: ActivityEvent[] }
  | { type: 'conversation:full'; turns: ConversationTurn[] };

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
  | { type: 'session:rename'; sessionId: string; name: string }
  /** Sent when the user completes a drag-and-drop reorder of session cards. */
  | { type: 'session:reorder'; sessionIds: string[] };
