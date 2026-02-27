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
      expect.objectContaining({
        'session-1': expect.objectContaining({ timestamp: expect.any(Number) }),
      })
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
      'session-1': expect.objectContaining({ timestamp: now + 1000 }),
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

  // ---- cwd support ----

  it('save/getCwd round-trip', async () => {
    await store.save('session-1', '/my/project');
    expect(store.getCwd('session-1')).toBe('/my/project');
  });

  it('getCwd returns undefined for unknown sessionId', () => {
    expect(store.getCwd('nonexistent')).toBeUndefined();
  });

  it('save() merge-preserves existing cwd when called without one', async () => {
    await store.save('session-1', '/my/project');
    await store.save('session-1');
    expect(store.getCwd('session-1')).toBe('/my/project');
  });

  it('save() with explicit cwd overwrites existing cwd', async () => {
    await store.save('session-1', '/old/path');
    await store.save('session-1', '/new/path');
    expect(store.getCwd('session-1')).toBe('/new/path');
  });

  it('backward compat: old format {id: number} loads with cwd undefined', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'old-session': Date.now(),
      },
    });
    const loaded = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toContain('old-session');
    expect(loaded.getCwd('old-session')).toBeUndefined();
  });

  it('new format {id: {timestamp, cwd}} loads correctly', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'new-session': { timestamp: Date.now(), cwd: '/projects/foo' },
      },
    });
    const loaded = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toContain('new-session');
    expect(loaded.getCwd('new-session')).toBe('/projects/foo');
  });

  it('mixed old and new format entries load correctly', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'old-session': Date.now(),
        'new-session': { timestamp: Date.now(), cwd: '/projects/bar' },
      },
    });
    const loaded = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getAll()).toHaveLength(2);
    expect(loaded.getCwd('old-session')).toBeUndefined();
    expect(loaded.getCwd('new-session')).toBe('/projects/bar');
  });

  it('load-then-persist migration: old format auto-migrates on save', async () => {
    const now = Date.now();
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS]: {
        'old-session': now,
      },
    });
    const loaded = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    // Trigger a persist by saving a new session
    await loaded.save('new-session', '/projects/baz');

    // The persisted data should now be in the new format for both
    expect(preloaded.update).toHaveBeenLastCalledWith(
      WORKSPACE_STATE_KEYS.LAUNCHED_SESSIONS,
      expect.objectContaining({
        'old-session': expect.objectContaining({ timestamp: now }),
        'new-session': expect.objectContaining({ cwd: '/projects/baz' }),
      })
    );

    // Re-load from the migrated storage to verify round-trip
    const reloaded = new LaunchedSessionStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );
    expect(reloaded.getAll()).toHaveLength(2);
    expect(reloaded.getCwd('old-session')).toBeUndefined();
    expect(reloaded.getCwd('new-session')).toBe('/projects/baz');
  });
});
