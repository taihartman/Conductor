import * as vscode from 'vscode';

/**
 * Metadata for a session history entry, persisted for the History tab.
 *
 * @remarks
 * Saved when a session is launched/adopted by Conductor, and updated
 * as the session's display name resolves. Used to populate the History
 * tab without re-parsing JSONL files.
 */
export interface HistoryEntryMeta {
  /** Session identifier (UUID). */
  sessionId: string;
  /** Display name at the time of save (auto-name, custom-name, or slug fallback). */
  displayName: string;
  /** Working directory of the session — used for resume. */
  cwd: string;
  /** Absolute path to the JSONL transcript file — used for existence validation. */
  filePath: string;
  /** Epoch ms timestamp of when this entry was saved or last updated. */
  savedAt: number;
}

/**
 * Persists session metadata for the History tab so users can browse and
 * resume Conductor-launched sessions from previous days.
 *
 * @remarks
 * Separate from {@link ILaunchedSessionStore} to keep concerns clean:
 * - `ILaunchedSessionStore` = "which sessions to auto-reconnect" (IDs + timestamps)
 * - `ISessionHistoryStore` = "rich metadata for history browsing" (names, paths, cwd)
 *
 * Entries are pruned after {@link AUTO_RECONNECT.TTL_DAYS} (7 days).
 */
export interface ISessionHistoryStore extends vscode.Disposable {
  /** Persist a session's metadata with current timestamp. */
  save(entry: HistoryEntryMeta): Promise<void>;
  /** Update specific fields on an existing entry. No-op if entry doesn't exist. */
  update(sessionId: string, partial: Partial<Omit<HistoryEntryMeta, 'sessionId'>>): Promise<void>;
  /** Get all persisted entries (auto-prunes stale entries). */
  getAll(): HistoryEntryMeta[];
  /** Get a single entry by session ID, or undefined if not found. */
  get(sessionId: string): HistoryEntryMeta | undefined;
  /** Remove a session entry from persistence. */
  remove(sessionId: string): Promise<void>;
  /** Remove entries older than TTL. */
  prune(): Promise<void>;
}
