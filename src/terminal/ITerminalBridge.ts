import * as vscode from 'vscode';
import { InputSendStatus } from '../models/protocol';

/**
 * Delivers user input to a VS Code terminal running Claude Code.
 *
 * @remarks
 * Implementations manage the mapping from session IDs to terminals.
 * The v1 strategy uses a QuickPick for manual terminal selection.
 */
export interface ITerminalBridge extends vscode.Disposable {
  /** Send text to the terminal associated with a session. */
  sendInput(sessionId: string, text: string): Promise<InputSendStatus>;
  /** Whether a terminal is cached for the given session. */
  hasTerminal(sessionId: string): boolean;
}
