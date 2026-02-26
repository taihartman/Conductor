import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LaunchedSessionStore } from '../persistence/LaunchedSessionStore';
import { WORKSPACE_STATE_KEYS, AUTO_RECONNECT } from '../constants';

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

describe('LaunchedSessionStore', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let store: LaunchedSessionStore;

  beforeEach(() => {
    memento = createMockMemento();
    outputChannel = createMockOutputChannel();
    store = new LaunchedSessionStore(
      memento as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );
  });

  // ---- Happy paths ----

  it('returns [] when nothing stored', () => {
    expect(store.getAll()).toEqual([]);
  });

  it('save() persists sessionId with timestamp and writes to workspaceState', async () => {
    await store.save('session-1');
    expect(store.getAll()).toContain('session-1');
    expect(memento.update).toHaveBeenCalledWith(
      WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS,
      expect.objectContaining({ 'session-1': expect.any(Number) })
    );
  });

  it('remove() deletes sessionId and writes to workspaceState', async () => {
    await store.save('session-1');
    await store.remove('session-1');
    expect(store.getAll()).toEqual([]);
    expect(memento.update).toHaveBeenLastCalledWith(WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS, {});
  });

  it('remove() is a no-op for unknown sessionId', async () => {
    memento.update.mockClear();
    await store.remove('nonexistent');
    expect(memento.update).not.toHaveBeenCalled();
  });

  it('getAll() returns all saved IDs', async () => {
    await store.save('a');
    await store.save('b');
    await store.save('c');
    const ids = store.getAll();
    expect(ids).toHaveLength(3);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  it('duplicate save() updates timestamp', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 1000);

    await store.save('session-1');
    await store.save('session-1');

    expect(store.getAll()).toEqual(['session-1']);
    // The second save should have the later timestamp
    expect(memento.update).toHaveBeenLastCalledWith(WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS, {
      'session-1': now + 1000,
    });

    vi.restoreAllMocks();
  });

  it('getAll() auto-prunes entries older than TTL', async () => {
    const now = Date.now();
    const staleTimestamp = now - (AUTO_RECONNECT.TTL_DAYS + 1) * 24 * 60 * 60 * 1000;

    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'stale-session': staleTimestamp,
        'fresh-session': now,
      },
    });
    const storeWithStale = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    const ids = storeWithStale.getAll();
    expect(ids).toEqual(['fresh-session']);
  });

  it('prune() removes stale entries and persists', async () => {
    const now = Date.now();
    const staleTimestamp = now - (AUTO_RECONNECT.TTL_DAYS + 1) * 24 * 60 * 60 * 1000;

    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'stale-1': staleTimestamp,
        'stale-2': staleTimestamp - 1000,
        'fresh-1': now,
      },
    });
    const storeWithStale = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    await storeWithStale.prune();
    expect(storeWithStale.getAll()).toEqual(['fresh-1']);
    expect(outputChannel.appendLine).toHaveBeenCalled();
  });

  it('dispose() is a no-op (no errors)', () => {
    expect(() => store.dispose()).not.toThrow();
  });

  // ---- Loads from storage ----

  it('loads existing entries from workspaceState on construction', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'session-a': Date.now(),
        'session-b': Date.now(),
      },
    });
    const loaded = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toHaveLength(2);
    expect(loaded.getAll()).toContain('session-a');
    expect(loaded.getAll()).toContain('session-b');
  });

  // ---- Defensive loading ----

  it('handles non-object stored data gracefully (string)', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: 'not-an-object',
    });
    const loaded = new LaunchedSessionStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toEqual([]);
  });

  it('handles array stored data gracefully', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: ['session-1', 'session-2'],
    });
    const loaded = new LaunchedSessionStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toEqual([]);
  });

  it('handles null stored value', () => {
    const nulled = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: null,
    });
    const loaded = new LaunchedSessionStore(
      nulled as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toEqual([]);
  });

  it('filters entries with non-number values', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'valid-session': Date.now(),
        'bad-session': 'not-a-number',
        'another-bad': null,
        'also-bad': true,
      },
    });
    const loaded = new LaunchedSessionStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toEqual(['valid-session']);
  });
});
