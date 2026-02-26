import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionVisibilityStore } from '../persistence/SessionVisibilityStore';
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

describe('SessionVisibilityStore', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let store: SessionVisibilityStore;

  beforeEach(() => {
    memento = createMockMemento();
    outputChannel = createMockOutputChannel();
    store = new SessionVisibilityStore(
      memento as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );
  });

  // ---- Initial state ----

  it('returns empty sets when nothing stored', () => {
    expect(store.getHiddenIds().size).toBe(0);
    expect(store.getForceShownIds().size).toBe(0);
  });

  // ---- hideSession ----

  it('hideSession adds to hidden set and fires event', async () => {
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.hideSession('s1');
    expect(store.getHiddenIds().has('s1')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(memento.update).toHaveBeenCalledWith(WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS, ['s1']);
  });

  it('hideSession is idempotent — does not fire event on duplicate', async () => {
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.hideSession('s1');
    await store.hideSession('s1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // ---- unhideSession ----

  it('unhideSession removes from hidden set and fires event', async () => {
    await store.hideSession('s1');
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.unhideSession('s1');
    expect(store.getHiddenIds().has('s1')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unhideSession is idempotent — does not fire event if not hidden', async () => {
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.unhideSession('s1');
    expect(listener).toHaveBeenCalledTimes(0);
  });

  // ---- forceShowSession ----

  it('forceShowSession adds to force-shown set and fires event', async () => {
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.forceShowSession('s2');
    expect(store.getForceShownIds().has('s2')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(memento.update).toHaveBeenCalledWith(WORKSPACE_STATE_KEYS.FORCE_SHOWN_SESSIONS, ['s2']);
  });

  it('forceShowSession is idempotent — does not fire event on duplicate', async () => {
    await store.forceShowSession('s2');
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.forceShowSession('s2');
    expect(listener).toHaveBeenCalledTimes(0);
  });

  // ---- unforceShowSession ----

  it('unforceShowSession removes from force-shown set and fires event', async () => {
    await store.forceShowSession('s2');
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.unforceShowSession('s2');
    expect(store.getForceShownIds().has('s2')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unforceShowSession is idempotent — does not fire event if not force-shown', async () => {
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.unforceShowSession('s2');
    expect(listener).toHaveBeenCalledTimes(0);
  });

  // ---- pruneStaleIds ----

  it('pruneStaleIds removes dead IDs and returns true', async () => {
    await store.hideSession('s1');
    await store.hideSession('s2');
    await store.forceShowSession('s3');

    const result = await store.pruneStaleIds(new Set(['s1']));
    expect(result).toBe(true);
    expect(store.getHiddenIds().has('s1')).toBe(true);
    expect(store.getHiddenIds().has('s2')).toBe(false);
    expect(store.getForceShownIds().has('s3')).toBe(false);
  });

  it('pruneStaleIds returns false when nothing to prune', async () => {
    await store.hideSession('s1');
    const result = await store.pruneStaleIds(new Set(['s1']));
    expect(result).toBe(false);
  });

  it('pruneStaleIds does NOT fire onVisibilityChanged', async () => {
    await store.hideSession('s1');
    const listener = vi.fn();
    store.onVisibilityChanged(listener);

    await store.pruneStaleIds(new Set());
    expect(listener).toHaveBeenCalledTimes(0);
  });

  // ---- Storage loading ----

  it('loads from storage on construction', () => {
    const preloaded = createMockMemento({
      [WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS]: ['a', 'b'],
      [WORKSPACE_STATE_KEYS.FORCE_SHOWN_SESSIONS]: ['c'],
    });
    const loaded = new SessionVisibilityStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getHiddenIds().has('a')).toBe(true);
    expect(loaded.getHiddenIds().has('b')).toBe(true);
    expect(loaded.getForceShownIds().has('c')).toBe(true);
  });

  // ---- Error paths ----

  it('handles non-array stored data gracefully → returns empty set', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS]: 'not-an-array',
    });
    const loaded = new SessionVisibilityStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getHiddenIds().size).toBe(0);
  });

  it('filters non-string entries from stored array', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS]: ['valid', 42, null, 'also-valid', true],
    });
    const loaded = new SessionVisibilityStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getHiddenIds().size).toBe(2);
    expect(loaded.getHiddenIds().has('valid')).toBe(true);
    expect(loaded.getHiddenIds().has('also-valid')).toBe(true);
  });

  it('handles null stored value → returns empty set', () => {
    const nulled = createMockMemento({
      [WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS]: null,
    });
    const loaded = new SessionVisibilityStore(
      nulled as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getHiddenIds().size).toBe(0);
  });

  it('handles object stored data gracefully → returns empty set', () => {
    const corrupted = createMockMemento({
      [WORKSPACE_STATE_KEYS.HIDDEN_SESSIONS]: { a: 1, b: 2 },
    });
    const loaded = new SessionVisibilityStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getHiddenIds().size).toBe(0);
  });
});
