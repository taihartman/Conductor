import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionHistoryService } from '../persistence/SessionHistoryService';
import type { ISessionHistoryStore, HistoryEntryMeta } from '../persistence/ISessionHistoryStore';
import type { ISessionNameStore } from '../persistence/ISessionNameStore';

// ── Mock vscode ──────────────────────────────────────────────────────
vi.mock('vscode', () => ({}));

// ── Mock fs ──────────────────────────────────────────────────────────
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ mtime: new Date('2026-02-27T12:00:00Z') })),
}));

import * as fs from 'fs';

// ── Helpers ──────────────────────────────────────────────────────────

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

function createMockHistoryStore(entries: HistoryEntryMeta[] = []): ISessionHistoryStore {
  return {
    getAll: vi.fn(() => entries),
    get: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    prune: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ISessionHistoryStore;
}

function createMockNameStore(names: Record<string, string> = {}): ISessionNameStore {
  return {
    getName: vi.fn((id: string) => names[id] || undefined),
    setName: vi.fn(),
    onNamesChanged: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  } as unknown as ISessionNameStore;
}

describe('SessionHistoryService', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date('2026-02-27T12:00:00Z') } as any);
  });

  it('returns entries with existing JSONL files', () => {
    const store = createMockHistoryStore([makeEntry('abc')]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set());

    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe('abc');
  });

  it('excludes entries whose JSONL file no longer exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const store = createMockHistoryStore([makeEntry('gone')]);
    const service = new SessionHistoryService(store, createMockNameStore());

    expect(service.buildEntries(new Set())).toHaveLength(0);
  });

  it('marks active sessions with isActive: true', () => {
    const store = createMockHistoryStore([makeEntry('active-id'), makeEntry('inactive-id')]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set(['active-id']));

    const active = entries.find((e) => e.sessionId === 'active-id');
    const inactive = entries.find((e) => e.sessionId === 'inactive-id');
    expect(active?.isActive).toBe(true);
    expect(inactive?.isActive).toBe(false);
  });

  it('excludes sub-agent sessions (sessionId starting with agent-)', () => {
    const store = createMockHistoryStore([makeEntry('agent-sub-123'), makeEntry('normal-session')]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set());

    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe('normal-session');
  });

  it('sorts entries by lastActivityAt descending (newest first)', () => {
    vi.mocked(fs.statSync)
      .mockReturnValueOnce({ mtime: new Date('2026-02-25T00:00:00Z') } as any)
      .mockReturnValueOnce({ mtime: new Date('2026-02-27T00:00:00Z') } as any);

    const store = createMockHistoryStore([makeEntry('older'), makeEntry('newer')]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set());

    expect(entries[0].sessionId).toBe('newer');
    expect(entries[1].sessionId).toBe('older');
  });

  it('enriches display name from SessionNameStore', () => {
    const store = createMockHistoryStore([makeEntry('abc', { displayName: 'Original' })]);
    const nameStore = createMockNameStore({ abc: 'Custom Name' });
    const service = new SessionHistoryService(store, nameStore);

    const entries = service.buildEntries(new Set());

    expect(entries[0].displayName).toBe('Custom Name');
  });

  it('falls back to stored displayName when SessionNameStore has no name', () => {
    const store = createMockHistoryStore([makeEntry('abc', { displayName: 'Stored Name' })]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set());

    expect(entries[0].displayName).toBe('Stored Name');
  });

  it('falls back to sessionId slug when no name is available', () => {
    const store = createMockHistoryStore([makeEntry('abcdefgh-1234-5678', { displayName: '' })]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set());

    expect(entries[0].displayName).toBe('abcdefgh');
  });

  it('uses file mtime for lastActivityAt', () => {
    const expectedDate = new Date('2026-02-27T12:00:00Z');
    vi.mocked(fs.statSync).mockReturnValue({ mtime: expectedDate } as any);

    const store = createMockHistoryStore([makeEntry('abc')]);
    const service = new SessionHistoryService(store, createMockNameStore());

    const entries = service.buildEntries(new Set());

    expect(entries[0].lastActivityAt).toBe(expectedDate.toISOString());
  });
});
