import * as vscode from 'vscode';
import type { LaunchMode } from '../models/sharedConstants';

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
   * @param mode - Launch mode: normal (default), yolo, or remote
   * @returns The session ID (pre-assigned UUID), or throws on failure
   */
  launch(cwd?: string, mode?: LaunchMode): Promise<string>;

  /**
   * Resume an existing external session by opening a new terminal with `claude --resume`.
   * The first message is delivered atomically via `--print` to avoid stdin race conditions.
   *
   * @param sessionId - The session ID to resume
   * @param text - The user's message to deliver via `--print`
   * @param cwd - Working directory for the terminal (defaults to workspace root)
   */
  resume(sessionId: string, text: string, cwd?: string): Promise<void>;

  /**
   * Transfer a running session from an external terminal into Conductor's PTY.
   * When searchIds is provided, tries each ID against ProcessDiscovery.
   * Falls back to direct resume() if no owning terminal is found.
   *
   * @param sessionId - The session ID to transfer (used for resume fallback)
   * @param text - The user's message to deliver via `--print`
   * @param cwd - Working directory for the terminal (defaults to workspace root)
   * @param searchIds - Optional continuation group member IDs to search for
   * @returns The session ID that was actually resumed
   */
  transfer(
    sessionId: string,
    text: string,
    cwd?: string,
    searchIds?: readonly string[]
  ): Promise<string>;

  /** Whether the given session was launched by Conductor (has PTY ownership). */
  isLaunchedSession(sessionId: string): boolean;

  /** Event fired when PTY data arrives from a launched session's stdout. */
  readonly onPtyData: vscode.Event<{ sessionId: string; data: string }>;

  /** Event fired when a launched session's process exits. */
  readonly onSessionExit: vscode.Event<{ sessionId: string; code: number | null }>;

  /** Show the VS Code terminal tab for a launched session (focus the terminal panel). */
  showTerminal(sessionId: string): void;

  /**
   * Force-kill the terminal and PTY process for a launched session.
   * Fires onSessionExit and removes the session from internal state.
   * @param sessionId - The session to kill
   * @returns true if session was found and killed, false if not found
   */
  killSession(sessionId: string): boolean;

  /** Write raw input data to a launched session's stdin. */
  writeInput(sessionId: string, data: string): void;

  /** Notify a launched session of a terminal resize. */
  resize(sessionId: string, cols: number, rows: number): void;

  /**
   * Set a callback that fires before pty.spawn() to allow pre-registration
   * (e.g. PtyBridge.registerSession) before data starts flowing.
   */
  setPreSpawnCallback(cb: (sessionId: string) => void): void;
}
