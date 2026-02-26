import * as vscode from 'vscode';

/**
 * Relays PTY I/O between Conductor-launched sessions and the webview xterm.js terminal.
 *
 * @remarks
 * Manages a ring buffer per session for webview reconnect replay.
 */
export interface IPtyBridge extends vscode.Disposable {
  /** Register a launched session for PTY data relay. */
  registerSession(sessionId: string): void;

  /** Unregister a session (e.g., on exit). */
  unregisterSession(sessionId: string): void;

  /** Append PTY output data to the session's ring buffer. */
  pushData(sessionId: string, data: string): void;

  /** Get the ring buffer contents for replay (e.g., on webview reconnect). */
  getBufferedData(sessionId: string): string;

  /** Whether a session is registered with this bridge. */
  hasSession(sessionId: string): boolean;
}
