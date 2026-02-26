import * as vscode from 'vscode';

/**
 * Manages session visibility via two persisted sets:
 *
 * | Action  | isArtifact? | Effect                                  |
 * |---------|-------------|-----------------------------------------|
 * | hide    | no          | add to hiddenSessionIds                 |
 * | hide    | yes         | remove from forceShownSessionIds        |
 * | unhide  | no          | remove from hiddenSessionIds            |
 * | unhide  | yes         | add to forceShownSessionIds             |
 *
 * Visibility: hidden = in hiddenIds OR (isArtifact AND NOT in forceShownIds)
 */
export interface ISessionVisibilityStore extends vscode.Disposable {
  /** Get the set of session IDs manually hidden by the user. */
  getHiddenIds(): ReadonlySet<string>;

  /** Get the set of artifact session IDs the user explicitly unhid. */
  getForceShownIds(): ReadonlySet<string>;

  /** Add a session to the hidden set. */
  hideSession(sessionId: string): Promise<void>;

  /** Remove a session from the hidden set. */
  unhideSession(sessionId: string): Promise<void>;

  /** Add an artifact session to the force-shown set. */
  forceShowSession(sessionId: string): Promise<void>;

  /** Remove an artifact session from the force-shown set. */
  unforceShowSession(sessionId: string): Promise<void>;

  /** Removes IDs not in liveSessionIds. Does NOT fire onVisibilityChanged. */
  pruneStaleIds(liveSessionIds: Set<string>): Promise<boolean>;

  /** Fires after a hide/unhide/forceShow/unforceShow mutation is persisted. */
  readonly onVisibilityChanged: vscode.Event<void>;
}
