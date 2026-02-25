import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionNameStore } from '../persistence/SessionNameStore';
import { STORAGE_KEYS, TRUNCATION } from '../constants';

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

describe('SessionNameStore', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let store: SessionNameStore;

  beforeEach(() => {
    memento = createMockMemento();
    outputChannel = createMockOutputChannel();
    store = new SessionNameStore(
      memento as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );
  });

  // ---- Happy paths ----

  it('returns undefined for unknown session', () => {
    expect(store.getName('nonexistent')).toBeUndefined();
  });

  it('persists a name and retrieves it', async () => {
    await store.setName('session-1', 'auth refactor');
    expect(store.getName('session-1')).toBe('auth refactor');
    expect(memento.update).toHaveBeenCalledWith(STORAGE_KEYS.SESSION_NAMES, {
      'session-1': 'auth refactor',
    });
  });

  it('clearName removes the entry', async () => {
    await store.setName('session-1', 'my name');
    await store.clearName('session-1');
    expect(store.getName('session-1')).toBeUndefined();
  });

  it('setName with empty string clears the name', async () => {
    await store.setName('session-1', 'initial name');
    await store.setName('session-1', '');
    expect(store.getName('session-1')).toBeUndefined();
  });

  it('fires onNamesChanged on setName', async () => {
    const listener = vi.fn();
    store.onNamesChanged(listener);

    await store.setName('session-1', 'test');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires onNamesChanged on clearName', async () => {
    await store.setName('session-1', 'test');
    const listener = vi.fn();
    store.onNamesChanged(listener);

    await store.clearName('session-1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('loads existing names from globalState on construction', () => {
    const preloaded = createMockMemento({
      [STORAGE_KEYS.SESSION_NAMES]: {
        s1: 'name one',
        s2: 'name two',
      },
    });
    const loaded = new SessionNameStore(
      preloaded as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getName('s1')).toBe('name one');
    expect(loaded.getName('s2')).toBe('name two');
  });

  // ---- Error paths ----

  it('setName with whitespace-only string clears the name', async () => {
    await store.setName('session-1', 'original');
    await store.setName('session-1', '   \t  ');
    expect(store.getName('session-1')).toBeUndefined();
  });

  it('setName truncates names exceeding SESSION_NAME_MAX', async () => {
    const longName = 'a'.repeat(TRUNCATION.SESSION_NAME_MAX + 50);
    await store.setName('session-1', longName);

    const result = store.getName('session-1');
    expect(result).toHaveLength(TRUNCATION.SESSION_NAME_MAX);
    expect(result).toBe('a'.repeat(TRUNCATION.SESSION_NAME_MAX));
  });

  it('handles corrupted globalState (non-object) gracefully', () => {
    const corrupted = createMockMemento({
      [STORAGE_KEYS.SESSION_NAMES]: 'not-an-object',
    });
    const loaded = new SessionNameStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getName('anything')).toBeUndefined();
  });

  it('handles corrupted globalState (array) gracefully', () => {
    const corrupted = createMockMemento({
      [STORAGE_KEYS.SESSION_NAMES]: ['not', 'valid'],
    });
    const loaded = new SessionNameStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getName('anything')).toBeUndefined();
  });

  it('handles corrupted globalState (non-string values) gracefully', () => {
    const corrupted = createMockMemento({
      [STORAGE_KEYS.SESSION_NAMES]: {
        s1: 'valid',
        s2: 42,
        s3: null,
      },
    });
    const loaded = new SessionNameStore(
      corrupted as unknown as import('vscode').Memento,
      outputChannel as unknown as import('vscode').OutputChannel
    );

    expect(loaded.getName('s1')).toBe('valid');
    expect(loaded.getName('s2')).toBeUndefined();
    expect(loaded.getName('s3')).toBeUndefined();
  });

  it('clearName on non-existent session is a no-op (no event fired)', async () => {
    const listener = vi.fn();
    store.onNamesChanged(listener);

    await store.clearName('nonexistent');
    expect(listener).not.toHaveBeenCalled();
    expect(memento.update).not.toHaveBeenCalled();
  });

  it('trims leading/trailing whitespace from names', async () => {
    await store.setName('session-1', '  trimmed name  ');
    expect(store.getName('session-1')).toBe('trimmed name');
  });
});
