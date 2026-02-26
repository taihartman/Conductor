import * as vscode from 'vscode';

/**
 * Launches Claude Code sessions from within Conductor and manages PTY ownership.
 *
 * @remarks
 * Implementations spawn `claude` via child_process, wrap it in a VS Code Pseudoterminal,
 * and pre-assign a UUID session ID via `--session-id` for instant launch.
 */
export interface ISessionLauncher extends vscode.Disposable {
  /**
   * Launch a new Claude Code session.
   *
   * @param cwd - Working directory for the session (defaults to workspace root)
   * @returns The session ID (pre-assigned UUID), or throws on failure
   */
  launch(cwd?: string): Promise<string>;

  /** Whether the given session was launched by Conductor (has PTY ownership). */
  isLaunchedSession(sessionId: string): boolean;

  /** Event fired when PTY data arrives from a launched session's stdout. */
  readonly onPtyData: vscode.Event<{ sessionId: string; data: string }>;

  /** Event fired when a launched session's process exits. */
  readonly onSessionExit: vscode.Event<{ sessionId: string; code: number | null }>;

  /** Write raw input data to a launched session's stdin. */
  writeInput(sessionId: string, data: string): void;

  /** Notify a launched session of a terminal resize. */
  resize(sessionId: string, cols: number, rows: number): void;
}
