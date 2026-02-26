import * as vscode from 'vscode';
import { ISessionVisibilityStore } from './ISessionVisibilityStore';
import { WORKSPACE_STATE_KEYS, LOG_PREFIX } from '../constants';

/**
 * Persists session visibility state to VS Code `workspaceState`.
 *
 * @remarks
 * Manages two sets: `hiddenIds` (manually hidden sessions) and `forceShownIds`
 * (artifact sessions the user explicitly unhid). Keeps in-memory sets for
 * synchronous reads and writes through to `workspaceState` for durability.
 * Corrupted storage data is handled gracefully — sets are reset to empty.
 */
export class SessionVisibilityStore implements ISessionVisibilityStore {
  private hiddenIds: Set<string>;
  private forceShownIds: Set<string>;
  private readonly workspaceState: vscode.Memento;
  private readonly outputChannel: vscode.OutputChannel;

  private readonly _onVisibilityChanged = new vscode.EventEmitter<void>();
  public readonly onVisibilityChanged = this._onVisibilityChanged.event;

  constructor(workspaceState: vscode.Memento, outputChannel: vscode.OutputChannel) {
    this.workspaceState = workspaceState;
    this.outputChannel = outputChannel;
    this.hiddenIds = this.loadFromStorage(WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS);
    this.forceShownIds = this.loadFromStorage(WORKSPACE_STATE_KEYS.FORCE_SHOWN_SESSIONS);
    console.log(
      `${LOG_PREFIX.VISIBILITY_STORE} Initialized with ${this.hiddenIds.size} hidden, ${this.forceShownIds.size} force-shown`
    );
  }

  /** Returns the set of manually hidden session IDs. */
  getHiddenIds(): ReadonlySet<string> {
    return this.hiddenIds;
  }

  /** Returns the set of artifact session IDs the user explicitly unhid. */
  getForceShownIds(): ReadonlySet<string> {
    return this.forceShownIds;
  }

  /** Adds a session to the hidden set. No-op if already hidden. */
  async hideSession(sessionId: string): Promise<void> {
    if (this.hiddenIds.has(sessionId)) return;
    this.hiddenIds.add(sessionId);
    await this.persistHidden();
    console.log(`${LOG_PREFIX.VISIBILITY_STORE} Hidden session ${sessionId}`);
    this.outputChannel.appendLine(`${LOG_PREFIX.VISIBILITY_STORE} Hidden session ${sessionId}`);
    this._onVisibilityChanged.fire();
  }

  /** Removes a session from the hidden set. No-op if not hidden. */
  async unhideSession(sessionId: string): Promise<void> {
    if (!this.hiddenIds.has(sessionId)) return;
    this.hiddenIds.delete(sessionId);
    await this.persistHidden();
    console.log(`${LOG_PREFIX.VISIBILITY_STORE} Unhidden session ${sessionId}`);
    this.outputChannel.appendLine(`${LOG_PREFIX.VISIBILITY_STORE} Unhidden session ${sessionId}`);
    this._onVisibilityChanged.fire();
  }

  /** Adds an artifact session to the force-shown set. No-op if already present. */
  async forceShowSession(sessionId: string): Promise<void> {
    if (this.forceShownIds.has(sessionId)) return;
    this.forceShownIds.add(sessionId);
    await this.persistForceShown();
    console.log(`${LOG_PREFIX.VISIBILITY_STORE} Force-shown session ${sessionId}`);
    this.outputChannel.appendLine(
      `${LOG_PREFIX.VISIBILITY_STORE} Force-shown session ${sessionId}`
    );
    this._onVisibilityChanged.fire();
  }

  /** Removes an artifact session from the force-shown set. No-op if not present. */
  async unforceShowSession(sessionId: string): Promise<void> {
    if (!this.forceShownIds.has(sessionId)) return;
    this.forceShownIds.delete(sessionId);
    await this.persistForceShown();
    console.log(`${LOG_PREFIX.VISIBILITY_STORE} Un-force-shown session ${sessionId}`);
    this.outputChannel.appendLine(
      `${LOG_PREFIX.VISIBILITY_STORE} Un-force-shown session ${sessionId}`
    );
    this._onVisibilityChanged.fire();
  }

  /** Removes IDs not in liveSessionIds. Does NOT fire onVisibilityChanged. */
  async pruneStaleIds(liveSessionIds: Set<string>): Promise<boolean> {
    let changed = false;

    for (const id of this.hiddenIds) {
      if (!liveSessionIds.has(id)) {
        this.hiddenIds.delete(id);
        changed = true;
      }
    }

    for (const id of this.forceShownIds) {
      if (!liveSessionIds.has(id)) {
        this.forceShownIds.delete(id);
        changed = true;
      }
    }

    if (changed) {
      await this.persistHidden();
      await this.persistForceShown();
      console.log(`${LOG_PREFIX.VISIBILITY_STORE} Pruned stale IDs`);
    }

    return changed;
  }

  /** Disposes the event emitter. */
  dispose(): void {
    this._onVisibilityChanged.dispose();
  }

  /** Hydrates a set from workspaceState, handling corrupted data gracefully. */
  private loadFromStorage(key: string): Set<string> {
    const raw = this.workspaceState.get<unknown>(key);

    if (raw === undefined || raw === null) {
      return new Set();
    }

    if (!Array.isArray(raw)) {
      console.log(
        `${LOG_PREFIX.VISIBILITY_STORE} Corrupted storage data for ${key} (expected array, got ${typeof raw}), resetting`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.VISIBILITY_STORE} Corrupted storage data for ${key}, resetting to empty`
      );
      return new Set();
    }

    return new Set(raw.filter((item): item is string => typeof item === 'string'));
  }

  private async persistHidden(): Promise<void> {
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS, [...this.hiddenIds]);
  }

  private async persistForceShown(): Promise<void> {
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.FORCE_SHOWN_SESSIONS, [
      ...this.forceShownIds,
    ]);
  }
}
