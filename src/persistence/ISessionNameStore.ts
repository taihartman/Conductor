import * as vscode from 'vscode';

/**
 * Contract for reading and persisting user-defined session display names.
 *
 * @remarks
 * Implementations must support synchronous reads (from an in-memory cache)
 * and asynchronous writes (to durable storage). The {@link onNamesChanged}
 * event fires after every successful persist so that listeners can refresh.
 */
export interface ISessionNameStore extends vscode.Disposable {
  /** Get the custom display name for a session, or `undefined` if none is set. */
  getName(sessionId: string): string | undefined;

  /**
   * Set a custom display name for a session.
   *
   * @remarks
   * The name is trimmed and truncated to {@link TRUNCATION.SESSION_NAME_MAX} characters.
   * An empty or whitespace-only name delegates to {@link clearName}.
   */
  setName(sessionId: string, name: string): Promise<void>;

  /** Remove the custom name for a session, reverting to the auto-generated slug. */
  clearName(sessionId: string): Promise<void>;

  /** Fires after a name is set or cleared and the change is persisted. */
  readonly onNamesChanged: vscode.Event<void>;
}
