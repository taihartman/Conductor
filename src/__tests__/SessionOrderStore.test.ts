import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionOrderStore } from '../persistence/SessionOrderStore';
import { WORKSPACE_STATE_KEYS } from '../constants';

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

describe('SessionOrderStore', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let store: SessionOrderStore;

  beforeEach(() => {
    memento = createMockMemento();
    outputChannel = createMockOutputChannel();
    store = new SessionOrderStore(
      memento as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );
  });

  // ---- Happy paths ----

  it('returns [] when nothing stored', () => {
    expect(store.getOrder()).toEqual([]);
  });

  it('setOrder persists and is readable via getOrder', async () => {
    await store.setOrder(['s1', 's2', 's3']);
    expect(store.getOrder()).toEqual(['s1', 's2', 's3']);
    expect(memento.update).toHaveBeenCalledWith(WORKSPACE_STATE_KEYS.SESSION_ORDER, [
      's1',
      's2',
      's3',
    ]);
  });

  it('setOrder fires onOrderChanged', async () => {
    const listener = vi.fn();
    store.onOrderChanged(listener);

    await store.setOrder(['s1']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('loads existing order from workspaceState on construction', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.SESSION_ORDER]: ['a', 'b', 'c'],
    });
    const loaded = new SessionOrderStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getOrder()).toEqual(['a', 'b', 'c']);
  });

  it('getOrder returns a copy (mutation safety)', async () => {
    await store.setOrder(['s1', 's2']);
    const order = store.getOrder();
    order.push('s3');
    expect(store.getOrder()).toEqual(['s1', 's2']);
  });

  // ---- Error paths ----

  it('handles non-array stored data gracefully → returns []', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.SESSION_ORDER]: 'not-an-array',
    });
    const loaded = new SessionOrderStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getOrder()).toEqual([]);
  });

  it('filters non-string entries from stored array', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.SESSION_ORDER]: ['valid', 42, null, 'also-valid', true],
    });
    const loaded = new SessionOrderStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getOrder()).toEqual(['valid', 'also-valid']);
  });

  it('handles null stored value → returns []', () => {
    const nulled = createMockMemento({
      [WORKSPACE_STATE_KEYS.SESSION_ORDER]: null,
    });
    const loaded = new SessionOrderStore(
      nulled as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getOrder()).toEqual([]);
  });

  it('handles object stored data gracefully → returns []', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.SESSION_ORDER]: { a: 1, b: 2 },
    });
    const loaded = new SessionOrderStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getOrder()).toEqual([]);
  });
});
