/**
 * @module IHookEventWatcher
 *
 * Interface for watching hook event files written by conductor-hook.sh.
 */

import * as vscode from 'vscode';
import { HookEvent } from '../models/types';

/**
 * Watches `~/.conductor/events/` for per-session hook event JSONL files.
 *
 * @remarks
 * Polls at 1s intervals, reads new bytes from each file using byte offset tracking.
 * Fires {@link onHookEvents} when new events are read from a session's event file.
 * Implements `vscode.Disposable` for cleanup of timers and file tracking state.
 */
export interface IHookEventWatcher extends vscode.Disposable {
  /** Start watching for hook events. */
  start(): void;
  /** Fired when new hook events are read from a session's event file. */
  readonly onHookEvents: vscode.Event<{ sessionId: string; events: HookEvent[] }>;
}
