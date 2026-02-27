import * as vscode from 'vscode';

/**
 * Persists session IDs launched/adopted by Conductor so they can be
 * auto-reconnected after extension reload.
 *
 * @remarks
 * Each entry stores a timestamp for TTL-based pruning of stale entries.
 */
export interface ILaunchedSessionStore extends vscode.Disposable {
  /**
   * Persist a session ID with current timestamp.
   * @param sessionId - The session ID to persist
   * @param cwd - Optional working directory to store alongside the session.
   *   When omitted, an existing cwd for this sessionId is preserved.
   */
  save(sessionId: string, cwd?: string): Promise<void>;
  /** Remove a session ID from persistence. */
  remove(sessionId: string): Promise<void>;
  /** Get all persisted IDs (auto-prunes stale entries). */
  getAll(): string[];
  /**
   * Retrieve the stored working directory for a session.
   * @param sessionId - The session ID to look up
   * @returns The cwd string if stored, or undefined
   */
  getCwd(sessionId: string): string | undefined;
  /** Remove entries older than TTL_DAYS. */
  prune(): Promise<void>;
}
