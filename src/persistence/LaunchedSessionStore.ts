import * as vscode from 'vscode';
import { ILaunchedSessionStore } from './ILaunchedSessionStore';
import { WORKSPACE_STATE_KEYS, LOG_PREFIX, AUTO_RECONNECT } from '../constants';

/** Internal entry format: timestamp + optional cwd. */
interface LaunchedEntry {
  readonly timestamp: number;
  readonly cwd?: string;
}

/**
 * Persists Conductor-launched/adopted session IDs to VS Code `workspaceState`.
 *
 * @remarks
 * Keeps an in-memory `Map<string, LaunchedEntry>` (sessionId → entry)
 * for synchronous reads and writes through to `workspaceState` for durability
 * across restarts. Corrupted storage data is handled gracefully — the map is
 * reset to empty.
 *
 * Backward-compatible with the old `{id: timestamp}` format: on load, plain
 * number values are promoted to `{timestamp, cwd: undefined}`. The first
 * `persist()` call auto-migrates to the new format.
 */
export class LaunchedSessionStore implements ILaunchedSessionStore {
  private readonly entries: Map<string, LaunchedEntry>;
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
   * @param cwd - Optional working directory. When omitted, an existing cwd
   *   for this sessionId is preserved (merge-preserve).
   */
  async save(sessionId: string, cwd?: string): Promise<void> {
    const existing = this.entries.get(sessionId);
    this.entries.set(sessionId, {
      timestamp: Date.now(),
      cwd: cwd ?? existing?.cwd,
    });
    await this.persist();
    console.log(
      `${LOG_PREFIX.LAUNCHED_STORE} Saved session ${sessionId} (cwd: ${cwd ?? existing?.cwd ?? 'none'})`
    );
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

  /**
   * Retrieve the stored working directory for a session.
   * @param sessionId - The session ID to look up
   * @returns The cwd string if stored, or undefined
   */
  getCwd(sessionId: string): string | undefined {
    return this.entries.get(sessionId)?.cwd;
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
    for (const [id, entry] of this.entries) {
      if (entry.timestamp < cutoff) {
        this.entries.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Load entries from workspaceState.
   *
   * @remarks
   * Backward-compatible: old format `{id: number}` loads as
   * `{timestamp: number, cwd: undefined}`. New format `{id: {timestamp, cwd}}`
   * loads fully. First `persist()` auto-migrates old entries.
   *
   * @returns Map of session ID to launched entry metadata
   */
  private loadFromStorage(): Map<string, LaunchedEntry> {
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

    const result = new Map<string, LaunchedEntry>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number') {
        // Old format: plain timestamp → promote to entry with no cwd
        result.set(key, { timestamp: value });
      } else if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>).timestamp === 'number'
      ) {
        // New format: {timestamp, cwd?}
        const entry = value as { timestamp: number; cwd?: string };
        result.set(key, {
          timestamp: entry.timestamp,
          cwd: typeof entry.cwd === 'string' ? entry.cwd : undefined,
        });
      }
    }
    return result;
  }

  private async persist(): Promise<void> {
    const obj: Record<string, { timestamp: number; cwd?: string }> = {};
    for (const [id, entry] of this.entries) {
      obj[id] = { timestamp: entry.timestamp, cwd: entry.cwd };
    }
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS, obj);
  }
}
