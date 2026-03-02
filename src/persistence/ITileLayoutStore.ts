import * as vscode from 'vscode';
import type { SavedTileLayout } from '../models/types';

/**
 * Contract for reading and persisting saved tile layout presets.
 *
 * @remarks
 * Implementations must support synchronous reads (from an in-memory cache)
 * and asynchronous writes (to durable storage). The {@link onLayoutsChanged}
 * event fires after every successful persist so that listeners can refresh.
 */
export interface ITileLayoutStore extends vscode.Disposable {
  /** Get the persisted tile layout presets. Returns `[]` if none saved. */
  getLayouts(): SavedTileLayout[];

  /** Persist an updated list of tile layout presets. */
  setLayouts(layouts: SavedTileLayout[]): Promise<void>;

  /** Fires after layouts are changed and persisted. */
  readonly onLayoutsChanged: vscode.Event<void>;
}
