import * as vscode from 'vscode';
import type { SavedTileLayout } from '../models/types';
import { ITileLayoutStore } from './ITileLayoutStore';
import { WORKSPACE_STATE_KEYS } from '../constants';

/** Log prefix for the TileLayoutStore. */
const LOG = '[Conductor:TileLayoutStore]';

/**
 * Persists saved tile layout presets to VS Code `workspaceState`.
 *
 * @remarks
 * Keeps an in-memory `SavedTileLayout[]` for synchronous reads and writes
 * through to `workspaceState` for durability across restarts. Corrupted
 * storage data is handled gracefully — the array is reset to empty.
 */
export class TileLayoutStore implements ITileLayoutStore {
  private layouts: SavedTileLayout[];
  private readonly workspaceState: vscode.Memento;
  private readonly outputChannel: vscode.OutputChannel;

  private readonly _onLayoutsChanged = new vscode.EventEmitter<void>();
  public readonly onLayoutsChanged = this._onLayoutsChanged.event;

  constructor(workspaceState: vscode.Memento, outputChannel: vscode.OutputChannel) {
    this.workspaceState = workspaceState;
    this.outputChannel = outputChannel;
    this.layouts = this.loadFromStorage();
    console.log(`${LOG} Initialized with ${this.layouts.length} saved layout(s)`);
  }

  /**
   * Get the persisted tile layout presets. Returns a defensive copy.
   * @returns A shallow copy of the saved layouts array.
   */
  getLayouts(): SavedTileLayout[] {
    return [...this.layouts];
  }

  /**
   * Persist an updated list of tile layout presets.
   * @param layouts - The full list of layouts to persist (replaces existing).
   */
  async setLayouts(layouts: SavedTileLayout[]): Promise<void> {
    this.layouts = [...layouts];
    await this.persist();

    console.log(`${LOG} Persisted ${layouts.length} layout(s)`);
    this.outputChannel.appendLine(`${LOG} Persisted ${layouts.length} layout(s)`);
    this._onLayoutsChanged.fire();
  }

  /** Release the internal event emitter. */
  dispose(): void {
    this._onLayoutsChanged.dispose();
  }

  private loadFromStorage(): SavedTileLayout[] {
    const raw = this.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS);

    if (raw === undefined || raw === null) {
      return [];
    }

    if (!Array.isArray(raw)) {
      console.log(`${LOG} Corrupted storage data (expected array, got ${typeof raw}), resetting`);
      this.outputChannel.appendLine(`${LOG} Corrupted storage data, resetting to empty`);
      return [];
    }

    // Validate each entry has the minimum required shape
    return raw.filter((item): item is SavedTileLayout => {
      if (typeof item !== 'object' || item === null) return false;
      const obj = item as Record<string, unknown>;
      return (
        typeof obj.name === 'string' &&
        typeof obj.root === 'object' &&
        obj.root !== null &&
        typeof obj.layoutOrientation === 'string' &&
        typeof obj.createdAt === 'string'
      );
    });
  }

  private async persist(): Promise<void> {
    await this.workspaceState.update(WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS, this.layouts);
  }
}
