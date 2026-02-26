import * as vscode from 'vscode';
import { ISessionOrderStore } from './ISessionOrderStore';
import { WORKSPACE_STATE_KEYS, LOG_PREFIX } from '../constants';

/**
 * Persists the user's custom session card order to VS Code `workspaceState`.
 *
 * @remarks
 * Keeps an in-memory `string[]` for synchronous reads and writes through to
 * `workspaceState` for durability across restarts. Corrupted storage data
 * is handled gracefully — the array is reset to empty.
 */
export class SessionOrderStore implements ISessionOrderStore {
  private order: string[];
  private readonly workspaceState: vscode.Memento;
  private readonly outputChannel: vscode.OutputChannel;

  private readonly _onOrderChanged = new vscode.EventEmitter<void>();
  public readonly onOrderChanged = this._onOrderChanged.event;

  constructor(workspaceState: vscode.Memento, outputChannel: vscode.OutputChannel) {
    this.workspaceState = workspaceState;
    this.outputChannel = outputChannel;
    this.order = this.loadFromStorage();
    console.log(
      `${LOG_PREFIX.ORDER_STORE} Initialized with ${this.order.length} stored session(s)`
    );
  }

  /**
   * Get the persisted session ID order. Returns a defensive copy.
   *
   * @returns Array of session IDs in stored order, or empty array if none stored
   */
  getOrder(): string[] {
    return [...this.order];
  }

  /**
   * Persist a new session ID order.
   *
   * @param sessionIds - Ordered array of session IDs to persist
   */
  async setOrder(sessionIds: string[]): Promise<void> {
    this.order = [...sessionIds];
    await this.persist();

    console.log(`${LOG_PREFIX.ORDER_STORE} Persisted order with ${sessionIds.length} session(s)`);
    this.outputChannel.appendLine(
      `${LOG_PREFIX.ORDER_STORE} Persisted order with ${sessionIds.length} session(s)`
    );
    this._onOrderChanged.fire();
  }

  /** Release the internal event emitter. */
  dispose(): void {
    this._onOrderChanged.dispose();
  }

  private loadFromStorage(): string[] {
    const raw = this.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.SESSION_ORDER);

    if (raw === undefined || raw === null) {
      return [];
    }

    if (!Array.isArray(raw)) {
      console.log(
        `${LOG_PREFIX.ORDER_STORE} Corrupted storage data (expected array, got ${typeof raw}), resetting`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.ORDER_STORE} Corrupted storage data, resetting to empty`
      );
      return [];
    }

    return raw.filter((item): item is string => typeof item === 'string');
  }

  private async persist(): Promise<void> {
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.SESSION_ORDER, this.order);
  }
}
