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
import type { LaunchMode } from './sharedConstants';

/** Result of attempting to send user input to a Claude Code terminal. */
export type InputSendStatus = 'sent' | 'no-terminal' | 'error' | 'adopting';

/** Status of a session launch attempt. */
export type LaunchStatus = 'launched' | 'error';

/** Result of adopting an external session for terminal mode. */
export type AdoptStatus = 'adopted' | 'error';

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
      /** True when the extension host is running inside a Claude Code session. */
      isNestedSession: boolean;
    }
  | { type: 'activity:full'; events: ActivityEvent[] }
  | { type: 'conversation:full'; turns: ConversationTurn[] }
  /** Feedback after attempting to send input to a terminal. */
  | { type: 'user:input-status'; sessionId: string; status: InputSendStatus; error?: string }
  /** PTY output data for a Conductor-launched session's embedded terminal. */
  | { type: 'pty:data'; sessionId: string; data: string }
  /** Bulk PTY buffer replay on webview reconnect. Uses replace semantics (not append). */
  | { type: 'pty:buffers'; buffers: Record<string, string> }
  /** Result of a session launch attempt (success with sessionId, or error). */
  | { type: 'session:launch-status'; sessionId?: string; status: LaunchStatus; error?: string }
  /** Result of adopting an external session for terminal mode. */
  | { type: 'session:adopt-status'; sessionId: string; status: AdoptStatus; error?: string }
  /** Current settings values pushed to the webview. Sent on `ready` and after `settings:update`. */
  | { type: 'settings:current'; autoHidePatterns: string[] }
  /** Persisted launch mode preference pushed to the webview on `ready`. */
  | { type: 'launch-mode:current'; mode: LaunchMode }
  /** Extension-initiated session focus (e.g. from Quick Pick). Webview should update its selection. */
  | { type: 'session:focus-command'; sessionId: string };

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
  | { type: 'session:reorder'; sessionIds: string[] }
  /** User typed a message to send to the active Claude Code terminal. */
  | { type: 'user:send-input'; sessionId: string; text: string }
  /** Request to launch a new Claude Code session from within Conductor. */
  | { type: 'session:launch'; cwd?: string; mode?: LaunchMode }
  /** Raw PTY input (keystrokes) from the webview xterm.js terminal. */
  | { type: 'pty:input'; sessionId: string; data: string }
  /** Resize event from the webview xterm.js terminal. */
  | { type: 'pty:resize'; sessionId: string; cols: number; rows: number }
  /** User hides a session from the main view. */
  | { type: 'session:hide'; sessionId: string }
  /** User unhides a session from the Hidden tab. */
  | { type: 'session:unhide'; sessionId: string }
  /** Sent when user toggles to terminal mode on an external (non-Conductor) session. */
  | { type: 'session:adopt'; sessionId: string }
  /** Webview requests current settings values. */
  | { type: 'settings:get' }
  /** Webview updates auto-hide patterns (persisted to VS Code settings). */
  | { type: 'settings:update'; autoHidePatterns: string[] }
  /** User changed the launch mode preference in the split button dropdown. */
  | { type: 'session:set-launch-mode'; mode: LaunchMode };
