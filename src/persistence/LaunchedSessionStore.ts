import * as vscode from 'vscode';
import { ILaunchedSessionStore } from './ILaunchedSessionStore';
import { WORKSPACE_STATE_KEYS, LOG_PREFIX, AUTO_RECONNECT } from '../constants';

/**
 * Persists Conductor-launched/adopted session IDs to VS Code `workspaceState`.
 *
 * @remarks
 * Keeps an in-memory `Map<string, number>` (sessionId → epoch ms timestamp)
 * for synchronous reads and writes through to `workspaceState` for durability
 * across restarts. Corrupted storage data is handled gracefully — the map is
 * reset to empty.
 */
export class LaunchedSessionStore implements ILaunchedSessionStore {
  private readonly entries: Map<string, number>;
  private readonly workspaceState: vscode.Memento;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(workspaceState: vscode.Memento, outputChannel: vscode.OutputChannel) {
    this.workspaceState = workspaceState;
    this.outputChannel = outputChannel;
    this.entries = this.loadFromStorage();
    console.log(
      `${LOG_PREFIX.LAUNCHED_STORE} Initialized with ${this.entries.size} persisted session(s)`
    );
  }

  /**
   * Persist a session ID with current timestamp.
   * @param sessionId - The session ID to persist
   */
  async save(sessionId: string): Promise<void> {
    this.entries.set(sessionId, Date.now());
    await this.persist();
    console.log(`${LOG_PREFIX.LAUNCHED_STORE} Saved session ${sessionId}`);
  }

  /**
   * Remove a session ID from persistence.
   * @param sessionId - The session ID to remove
   */
  async remove(sessionId: string): Promise<void> {
    if (!this.entries.has(sessionId)) return;
    this.entries.delete(sessionId);
    await this.persist();
    console.log(`${LOG_PREFIX.LAUNCHED_STORE} Removed session ${sessionId}`);
  }

  /**
   * Get all persisted IDs (auto-prunes stale entries).
   *
   * @remarks
   * Calls {@link pruneStale} synchronously to remove expired entries.
   * If any were pruned, a deferred `persist()` is triggered (fire-and-forget).
   *
   * @returns Array of persisted session IDs
   */
  getAll(): string[] {
    const pruned = this.pruneStale();
    if (pruned > 0) {
      this.persist().catch((err) => {
        console.log(`${LOG_PREFIX.LAUNCHED_STORE} Failed to persist after prune: ${err}`);
      });
    }
    return Array.from(this.entries.keys());
  }

  /** Remove entries older than TTL_DAYS. */
  async prune(): Promise<void> {
    const pruned = this.pruneStale();
    if (pruned > 0) {
      await this.persist();
      console.log(`${LOG_PREFIX.LAUNCHED_STORE} Pruned ${pruned} stale session(s)`);
      this.outputChannel.appendLine(
        `${LOG_PREFIX.LAUNCHED_STORE} Pruned ${pruned} stale session(s)`
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
    for (const [id, timestamp] of this.entries) {
      if (timestamp < cutoff) {
        this.entries.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  private loadFromStorage(): Map<string, number> {
    const raw = this.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS);

    if (raw === undefined || raw === null) {
      return new Map();
    }

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      console.log(
        `${LOG_PREFIX.LAUNCHED_STORE} Corrupted storage data (expected object, got ${typeof raw}), resetting`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.LAUNCHED_STORE} Corrupted storage data, resetting to empty`
      );
      return new Map();
    }

    const result = new Map<string, number>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number') {
        result.set(key, value);
      }
    }
    return result;
  }

  private async persist(): Promise<void> {
    const obj: Record<string, number> = {};
    for (const [id, ts] of this.entries) {
      obj[id] = ts;
    }
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS, obj);
  }
}
