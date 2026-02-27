import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionHistoryStore } from '../persistence/SessionHistoryStore';
import type { HistoryEntryMeta } from '../persistence/ISessionHistoryStore';

// ── Mock vscode ──────────────────────────────────────────────────────
vi.mock('vscode', () => ({}));

// ── Helpers ──────────────────────────────────────────────────────────

const mockStore: Record<string, unknown> = {};

function createMockMemento(): any {
  return {
    get: vi.fn((key: string, fallback?: unknown) => mockStore[key] ?? fallback),
    update: vi.fn(async (key: string, value: unknown) => {
      mockStore[key] = value;
    }),
  };
}

function createMockOutputChannel(): any {
  return {
    appendLine: vi.fn(),
  };
}

function makeEntry(id: string, overrides?: Partial<HistoryEntryMeta>): HistoryEntryMeta {
  return {
    sessionId: id,
    displayName: `Session ${id}`,
    cwd: `/workspace/${id}`,
    filePath: `/home/.claude/projects/test/${id}.jsonl`,
    savedAt: Date.now(),
    ...overrides,
  };
}

describe('SessionHistoryStore', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key];
    }
  });

  function createStore(): SessionHistoryStore {
    memento = createMockMemento();
    outputChannel = createMockOutputChannel();
    return new SessionHistoryStore(memento, outputChannel);
  }

  describe('save and getAll round-trip', () => {
    it('returns saved entries', async () => {
      const store = createStore();
      const entry = makeEntry('abc-123');

      await store.save(entry);
      const all = store.getAll();

      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe('abc-123');
      expect(all[0].displayName).toBe('Session abc-123');
    });

    it('overwrites existing entry for the same sessionId', async () => {
      const store = createStore();
      await store.save(makeEntry('abc-123', { displayName: 'Original' }));
      await store.save(makeEntry('abc-123', { displayName: 'Updated' }));

      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].displayName).toBe('Updated');
    });
  });

  describe('get', () => {
    it('returns the entry for a known sessionId', async () => {
      const store = createStore();
      await store.save(makeEntry('abc-123'));

      expect(store.get('abc-123')?.sessionId).toBe('abc-123');
    });

    it('returns undefined for an unknown sessionId', () => {
      const store = createStore();
      expect(store.get('unknown')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('merges partial fields into an existing entry', async () => {
      const store = createStore();
      await store.save(makeEntry('abc-123', { displayName: 'Before' }));

      await store.update('abc-123', { displayName: 'After' });

      const entry = store.get('abc-123');
      expect(entry?.displayName).toBe('After');
      expect(entry?.cwd).toBe('/workspace/abc-123'); // unchanged
    });

    it('is a no-op for entries that do not exist', async () => {
      const store = createStore();
      await store.update('nonexistent', { displayName: 'Nope' });

      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('removes an existing entry', async () => {
      const store = createStore();
      await store.save(makeEntry('abc-123'));
      await store.remove('abc-123');

      expect(store.getAll()).toHaveLength(0);
    });

    it('is a no-op for entries that do not exist', async () => {
      const store = createStore();
      await store.remove('nonexistent');
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('TTL pruning', () => {
    it('removes entries older than 7 days on getAll()', () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;

      // Pre-populate storage with a stale entry and a fresh entry
      mockStore['conductor.sessionHistory'] = {
        stale: makeEntry('stale', { savedAt: eightDaysAgo }),
        fresh: makeEntry('fresh', { savedAt: Date.now() }),
      };

      const store = createStore();
      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe('fresh');
    });

    it('prune() removes stale entries and persists', async () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;

      // Pre-populate storage with a stale entry
      mockStore['conductor.sessionHistory'] = {
        stale: makeEntry('stale', { savedAt: eightDaysAgo }),
      };

      const store = createStore();
      await store.prune();

      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('corrupted storage handling', () => {
    it('resets to empty when storage contains a non-object', () => {
      mockStore['conductor.sessionHistory'] = 'not-an-object';
      const store = createStore();

      expect(store.getAll()).toHaveLength(0);
    });

    it('resets to empty when storage contains an array', () => {
      mockStore['conductor.sessionHistory'] = ['unexpected'];
      const store = createStore();

      expect(store.getAll()).toHaveLength(0);
    });

    it('skips entries with invalid shapes', () => {
      mockStore['conductor.sessionHistory'] = {
        'valid-id': makeEntry('valid-id'),
        'bad-id': { sessionId: 'bad-id' }, // missing required fields
      };
      const store = createStore();

      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe('valid-id');
    });
  });
});
