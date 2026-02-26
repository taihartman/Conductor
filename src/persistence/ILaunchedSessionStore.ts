import * as vscode from 'vscode';

/**
 * Persists session IDs launched/adopted by Conductor so they can be
 * auto-reconnected after extension reload.
 *
 * @remarks
 * Each entry stores a timestamp for TTL-based pruning of stale entries.
 */
export interface ILaunchedSessionStore extends vscode.Disposable {
  /** Persist a session ID with current timestamp. */
  save(sessionId: string): Promise<void>;
  /** Remove a session ID from persistence. */
  remove(sessionId: string): Promise<void>;
  /** Get all persisted IDs (auto-prunes stale entries). */
  getAll(): string[];
  /** Remove entries older than TTL_DAYS. */
  prune(): Promise<void>;
}
