import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TileLayoutStore } from '../persistence/TileLayoutStore';
import { WORKSPACE_STATE_KEYS } from '../constants';
import type { SavedTileLayout } from '../models/types';

/** Minimal vscode.Memento mock for testing. */
function createMockMemento(initial?: Record<string, unknown>): {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, unknown>(initial ? Object.entries(initial) : []);
  return {
    get: vi.fn((key: string) => store.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

function createMockOutputChannel(): { appendLine: ReturnType<typeof vi.fn> } {
  return { appendLine: vi.fn() };
}

const SAMPLE_LAYOUT: SavedTileLayout = {
  name: 'Two side-by-side',
  root: {
    type: 'split',
    id: 's1',
    direction: 'horizontal',
    children: [
      { type: 'leaf', id: 't1', sessionId: 'abc' },
      { type: 'leaf', id: 't2', sessionId: 'def' },
    ],
    sizes: [50, 50],
  },
  layoutOrientation: 'horizontal',
  createdAt: '2026-02-27T00:00:00Z',
};

describe('TileLayoutStore', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let store: TileLayoutStore;

  beforeEach(() => {
    memento = createMockMemento();
    outputChannel = createMockOutputChannel();
    store = new TileLayoutStore(
      memento as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );
  });

  // ---- Happy paths ----

  it('returns [] when nothing stored', () => {
    expect(store.getLayouts()).toEqual([]);
  });

  it('setLayouts persists and is readable via getLayouts', async () => {
    await store.setLayouts([SAMPLE_LAYOUT]);
    expect(store.getLayouts()).toEqual([SAMPLE_LAYOUT]);
    expect(memento.update).toHaveBeenCalledWith(WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS, [
      SAMPLE_LAYOUT,
    ]);
  });

  it('setLayouts fires onLayoutsChanged', async () => {
    const listener = vi.fn();
    store.onLayoutsChanged(listener);

    await store.setLayouts([SAMPLE_LAYOUT]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('loads existing layouts from workspaceState on construction', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS]: [SAMPLE_LAYOUT],
    });
    const loaded = new TileLayoutStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getLayouts()).toEqual([SAMPLE_LAYOUT]);
  });

  it('getLayouts returns a copy (mutation safety)', async () => {
    await store.setLayouts([SAMPLE_LAYOUT]);
    const layouts = store.getLayouts();
    layouts.push({ ...SAMPLE_LAYOUT, name: 'mutated' });
    expect(store.getLayouts()).toEqual([SAMPLE_LAYOUT]);
  });

  it('supports multiple layouts', async () => {
    const layout2: SavedTileLayout = {
      ...SAMPLE_LAYOUT,
      name: 'Stacked',
      root: { type: 'leaf', id: 't1', sessionId: 'abc' },
    };
    await store.setLayouts([SAMPLE_LAYOUT, layout2]);
    expect(store.getLayouts()).toHaveLength(2);
    expect(store.getLayouts()[1].name).toBe('Stacked');
  });

  // ---- Error paths ----

  it('handles non-array stored data gracefully → returns []', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS]: 'not-an-array',
    });
    const loaded = new TileLayoutStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getLayouts()).toEqual([]);
  });

  it('handles null stored value → returns []', () => {
    const nulled = createMockMemento({
      [WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS]: null,
    });
    const loaded = new TileLayoutStore(
      nulled as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getLayouts()).toEqual([]);
  });

  it('filters invalid entries from stored array', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS]: [
        SAMPLE_LAYOUT,
        42,
        null,
        { name: 'missing-root' }, // missing required fields
        {
          name: 'ok',
          root: { type: 'leaf', id: 't1', sessionId: null },
          layoutOrientation: 'horizontal',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    const loaded = new TileLayoutStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    const layouts = loaded.getLayouts();
    expect(layouts).toHaveLength(2);
    expect(layouts[0].name).toBe('Two side-by-side');
    expect(layouts[1].name).toBe('ok');
  });

  it('handles object stored data gracefully → returns []', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS]: { a: 1 },
    });
    const loaded = new TileLayoutStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getLayouts()).toEqual([]);
  });
});
