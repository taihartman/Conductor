import * as vscode from 'vscode';
import { ISessionHistoryStore, HistoryEntryMeta } from './ISessionHistoryStore';
import { WORKSPACE_STATE_KEYS, LOG_PREFIX, AUTO_RECONNECT } from '../constants';

/**
 * Persists Conductor-launched session metadata to VS Code `workspaceState`
 * for the History tab.
 *
 * @remarks
 * Keeps an in-memory `Map<string, HistoryEntryMeta>` for synchronous reads
 * and writes through to `workspaceState` for durability across restarts.
 * Corrupted storage data is handled gracefully — the map is reset to empty.
 *
 * Entries are pruned after {@link AUTO_RECONNECT.TTL_DAYS} (7 days).
 */
export class SessionHistoryStore implements ISessionHistoryStore {
  private readonly entries: Map<string, HistoryEntryMeta>;
  private readonly workspaceState: vscode.Memento;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(workspaceState: vscode.Memento, outputChannel: vscode.OutputChannel) {
    this.workspaceState = workspaceState;
    this.outputChannel = outputChannel;
    this.entries = this.loadFromStorage();
    console.log(
      `${LOG_PREFIX.HISTORY_STORE} Initialized with ${this.entries.size} persisted entry(ies)`
    );
  }

  /**
   * Persist a session's metadata.
   * Overwrites any existing entry for the same sessionId.
   * @param entry - The history entry metadata to save
   */
  async save(entry: HistoryEntryMeta): Promise<void> {
    this.entries.set(entry.sessionId, { ...entry, savedAt: Date.now() });
    await this.persist();
    console.log(`${LOG_PREFIX.HISTORY_STORE} Saved entry for session ${entry.sessionId}`);
  }

  /**
   * Update specific fields on an existing entry. No-op if entry doesn't exist.
   * @param sessionId - The session ID to update
   * @param partial - Fields to merge into the existing entry
   */
  async update(
    sessionId: string,
    partial: Partial<Omit<HistoryEntryMeta, 'sessionId'>>
  ): Promise<void> {
    const existing = this.entries.get(sessionId);
    if (!existing) {
      return;
    }
    this.entries.set(sessionId, { ...existing, ...partial, savedAt: Date.now() });
    await this.persist();
  }

  /**
   * Get all persisted entries (auto-prunes stale entries).
   *
   * @remarks
   * Calls {@link pruneStale} synchronously to remove expired entries.
   * If any were pruned, a deferred `persist()` is triggered (fire-and-forget).
   *
   * @returns Array of persisted history entry metadata
   */
  getAll(): HistoryEntryMeta[] {
    const pruned = this.pruneStale();
    if (pruned > 0) {
      this.persist().catch((err) => {
        console.log(`${LOG_PREFIX.HISTORY_STORE} Failed to persist after prune: ${err}`);
      });
    }
    return Array.from(this.entries.values());
  }

  /**
   * Get a single entry by session ID.
   * @param sessionId - The session ID to look up
   * @returns The entry, or undefined if not found
   */
  get(sessionId: string): HistoryEntryMeta | undefined {
    return this.entries.get(sessionId);
  }

  /**
   * Remove a session entry from persistence.
   * @param sessionId - The session ID to remove
   */
  async remove(sessionId: string): Promise<void> {
    if (!this.entries.has(sessionId)) return;
    this.entries.delete(sessionId);
    await this.persist();
    console.log(`${LOG_PREFIX.HISTORY_STORE} Removed entry for session ${sessionId}`);
  }

  /** Remove entries older than TTL_DAYS. */
  async prune(): Promise<void> {
    const pruned = this.pruneStale();
    if (pruned > 0) {
      await this.persist();
      console.log(`${LOG_PREFIX.HISTORY_STORE} Pruned ${pruned} stale entry(ies)`);
      this.outputChannel.appendLine(
        `${LOG_PREFIX.HISTORY_STORE} Pruned ${pruned} stale entry(ies)`
      );
    }
  }

  /** No-op — no EventEmitter to clean up. */
  dispose(): void {
    // Intentionally empty: no emitters or subscriptions to release.
  }

  /**
   * Remove entries older than TTL_DAYS from the in-memory map.
   * @returns Number of entries pruned
   */
  private pruneStale(): number {
    const cutoff = Date.now() - AUTO_RECONNECT.TTL_DAYS * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const [id, entry] of this.entries) {
      if (entry.savedAt < cutoff) {
        this.entries.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  private loadFromStorage(): Map<string, HistoryEntryMeta> {
    const raw = this.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.SESSION_HISTORY);

    if (raw === undefined || raw === null) {
      return new Map();
    }

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      console.log(
        `${LOG_PREFIX.HISTORY_STORE} Corrupted storage data (expected object, got ${typeof raw}), resetting`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.HISTORY_STORE} Corrupted storage data, resetting to empty`
      );
      return new Map();
    }

    const result = new Map<string, HistoryEntryMeta>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (this.isValidEntry(value)) {
        result.set(key, value);
      }
    }
    return result;
  }

  /**
   * Type guard validating that a stored value has the expected HistoryEntryMeta shape.
   * @param value - The value to check
   * @returns `true` if the value is a valid {@link HistoryEntryMeta}
   */
  private isValidEntry(value: unknown): value is HistoryEntryMeta {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj.sessionId === 'string' &&
      typeof obj.displayName === 'string' &&
      typeof obj.cwd === 'string' &&
      typeof obj.filePath === 'string' &&
      typeof obj.savedAt === 'number'
    );
  }

  private async persist(): Promise<void> {
    const obj: Record<string, HistoryEntryMeta> = {};
    for (const [id, entry] of this.entries) {
      obj[id] = entry;
    }
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.SESSION_HISTORY, obj);
  }
}
