import * as vscode from 'vscode';

/**
 * Automatically reconnects terminals for Conductor-launched sessions
 * after extension reload or VS Code restart.
 */
export interface IAutoReconnectService extends vscode.Disposable {
  /** Begin watching for initial session discovery, then auto-reconnect. */
  start(): void;
}
