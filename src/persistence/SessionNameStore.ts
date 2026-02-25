import * as vscode from 'vscode';
import { ISessionNameStore } from './ISessionNameStore';
import { STORAGE_KEYS, LOG_PREFIX, TRUNCATION } from '../constants';

/**
 * Persists user-defined session names to VS Code `globalState`.
 *
 * @remarks
 * Keeps an in-memory `Map` for synchronous reads and writes through to
 * `globalState` for durability across restarts. Corrupted storage data
 * is handled gracefully — the map is reset to empty.
 */
export class SessionNameStore implements ISessionNameStore {
  private readonly names: Map<string, string>;
  private readonly globalState: vscode.Memento;
  private readonly outputChannel: vscode.OutputChannel;

  private readonly _onNamesChanged = new vscode.EventEmitter<void>();
  public readonly onNamesChanged = this._onNamesChanged.event;

  constructor(globalState: vscode.Memento, outputChannel: vscode.OutputChannel) {
    this.globalState = globalState;
    this.outputChannel = outputChannel;
    this.names = this.loadFromStorage();
    console.log(`${LOG_PREFIX.NAME_STORE} Initialized with ${this.names.size} stored name(s)`);
  }

  /**
   * Get the custom display name for a session.
   *
   * @param sessionId - The session to look up
   * @returns The custom name, or `undefined` if none is set
   */
  getName(sessionId: string): string | undefined {
    return this.names.get(sessionId);
  }

  /**
   * Set a custom display name for a session.
   *
   * @param sessionId - The session to rename
   * @param name - The new display name (trimmed/truncated; empty clears)
   */
  async setName(sessionId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      await this.clearName(sessionId);
      return;
    }

    const truncated =
      trimmed.length > TRUNCATION.SESSION_NAME_MAX
        ? trimmed.slice(0, TRUNCATION.SESSION_NAME_MAX)
        : trimmed;

    this.names.set(sessionId, truncated);
    await this.persist();

    console.log(`${LOG_PREFIX.NAME_STORE} Renamed session ${sessionId} → "${truncated}"`);
    this.outputChannel.appendLine(
      `${LOG_PREFIX.NAME_STORE} Renamed session ${sessionId} → "${truncated}"`
    );
    this._onNamesChanged.fire();
  }

  /**
   * Remove the custom name for a session.
   *
   * @param sessionId - The session to revert to its auto-generated slug
   */
  async clearName(sessionId: string): Promise<void> {
    if (!this.names.has(sessionId)) {
      return;
    }

    this.names.delete(sessionId);
    await this.persist();

    console.log(`${LOG_PREFIX.NAME_STORE} Cleared name for session ${sessionId}`);
    this.outputChannel.appendLine(`${LOG_PREFIX.NAME_STORE} Cleared name for session ${sessionId}`);
    this._onNamesChanged.fire();
  }

  /** Release the internal event emitter. */
  dispose(): void {
    this._onNamesChanged.dispose();
  }

  private loadFromStorage(): Map<string, string> {
    const raw = this.globalState.get<unknown>(STORAGE_KEYS.SESSION_NAMES);

    if (raw === undefined || raw === null) {
      return new Map();
    }

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      console.log(
        `${LOG_PREFIX.NAME_STORE} Corrupted storage data (expected object, got ${typeof raw}), resetting`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.NAME_STORE} Corrupted storage data, resetting to empty`
      );
      return new Map();
    }

    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') {
        map.set(key, value);
      }
    }
    return map;
  }

  private async persist(): Promise<void> {
    const obj: Record<string, string> = {};
    for (const [key, value] of this.names) {
      obj[key] = value;
    }
    await this.globalState.update(STORAGE_KEYS.SESSION_NAMES, obj);
  }
}
