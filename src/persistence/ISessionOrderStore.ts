import * as vscode from 'vscode';

/**
 * Contract for reading and persisting the user's custom session card order.
 *
 * @remarks
 * Implementations must support synchronous reads (from an in-memory cache)
 * and asynchronous writes (to durable storage). The {@link onOrderChanged}
 * event fires after every successful persist so that listeners can refresh.
 */
export interface ISessionOrderStore extends vscode.Disposable {
  /** Get the persisted session ID order. Returns `[]` if no custom order is stored. */
  getOrder(): string[];

  /** Persist a new session ID order. */
  setOrder(sessionIds: string[]): Promise<void>;

  /** Fires after the order is changed and persisted. */
  readonly onOrderChanged: vscode.Event<void>;
}
