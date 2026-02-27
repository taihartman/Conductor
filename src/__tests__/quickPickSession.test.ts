vi.mock('vscode');

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sortSessionsByUrgency,
  resolveDisplayName,
  relativeTime,
  buildQuickPickItems,
} from '../commands/quickPickSession';
import type { SessionInfo } from '../models/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'sess-1',
    slug: 'abc123',
    summary: '',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    gitBranch: '',
    cwd: '',
    autoName: undefined,
    customName: undefined,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    isArtifact: false,
    filePath: '/tmp/test.jsonl',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sortSessionsByUrgency
// ---------------------------------------------------------------------------

describe('sortSessionsByUrgency', () => {
  it('sorts by status priority: waiting > error > working > thinking > done > idle', () => {
    const sessions = [
      makeSession({ sessionId: 'idle', status: 'idle' }),
      makeSession({ sessionId: 'thinking', status: 'thinking' }),
      makeSession({ sessionId: 'waiting', status: 'waiting' }),
      makeSession({ sessionId: 'done', status: 'done' }),
      makeSession({ sessionId: 'error', status: 'error' }),
      makeSession({ sessionId: 'working', status: 'working' }),
    ];

    const sorted = sortSessionsByUrgency(sessions);

    expect(sorted.map((s) => s.sessionId)).toEqual([
      'waiting',
      'error',
      'working',
      'thinking',
      'done',
      'idle',
    ]);
  });

  it('sorts by most recent activity within same status group', () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date(Date.now() - 10_000).toISOString();

    const sessions = [
      makeSession({ sessionId: 'old-idle', status: 'idle', lastActivityAt: older }),
      makeSession({ sessionId: 'new-idle', status: 'idle', lastActivityAt: newer }),
    ];

    const sorted = sortSessionsByUrgency(sessions);

    expect(sorted[0].sessionId).toBe('new-idle');
    expect(sorted[1].sessionId).toBe('old-idle');
  });

  it('does not mutate the input array', () => {
    const sessions = [
      makeSession({ sessionId: 'b', status: 'idle' }),
      makeSession({ sessionId: 'a', status: 'waiting' }),
    ];
    const original = [...sessions];

    sortSessionsByUrgency(sessions);

    expect(sessions[0].sessionId).toBe(original[0].sessionId);
    expect(sessions[1].sessionId).toBe(original[1].sessionId);
  });
});

// ---------------------------------------------------------------------------
// resolveDisplayName
// ---------------------------------------------------------------------------

describe('resolveDisplayName', () => {
  it('prefers customName over autoName', () => {
    const session = makeSession({ customName: 'My Custom', autoName: 'Auto Name' });
    expect(resolveDisplayName(session)).toBe('My Custom');
  });

  it('falls back to autoName when customName is undefined', () => {
    const session = makeSession({ customName: undefined, autoName: 'Auto Name' });
    expect(resolveDisplayName(session)).toBe('Auto Name');
  });

  it('falls back to sessionId when both names are undefined', () => {
    const session = makeSession({
      sessionId: 'sess-fallback',
      customName: undefined,
      autoName: undefined,
    });
    expect(resolveDisplayName(session)).toBe('sess-fallback');
  });
});

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------

describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-26T12:00:00Z'));
  });

  it('formats seconds (30s)', () => {
    const timestamp = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(timestamp)).toBe('30s');
  });

  it('formats minutes (5m)', () => {
    const timestamp = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(timestamp)).toBe('5m');
  });

  it('formats hours (2h)', () => {
    const timestamp = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(relativeTime(timestamp)).toBe('2h');
  });

  it('formats days (3d)', () => {
    const timestamp = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(relativeTime(timestamp)).toBe('3d');
  });

  it('returns at least 1s for very recent timestamps', () => {
    const timestamp = new Date(Date.now() - 100).toISOString();
    expect(relativeTime(timestamp)).toBe('1s');
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// buildQuickPickItems
// ---------------------------------------------------------------------------

describe('buildQuickPickItems', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-26T12:00:00Z'));
  });

  it('returns no-sessions message when empty', () => {
    const items = buildQuickPickItems([]);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('No active sessions found');
    expect(items[0].sessionId).toBeUndefined();
  });

  it('includes status icon in label', () => {
    const sessions = [makeSession({ status: 'waiting', sessionId: 'w1', autoName: 'My Session' })];
    const items = buildQuickPickItems(sessions);

    // First item is a separator, second is the session
    const sessionItem = items.find((i) => i.sessionId === 'w1');
    expect(sessionItem).toBeDefined();
    expect(sessionItem!.label).toContain('$(bell)');
    expect(sessionItem!.label).toContain('My Session');
  });

  it('inserts separator items between status groups', () => {
    const sessions = [
      makeSession({ status: 'waiting', sessionId: 'w1' }),
      makeSession({ status: 'working', sessionId: 'a1' }),
      makeSession({ status: 'idle', sessionId: 'i1' }),
    ];

    const items = buildQuickPickItems(sessions);

    // QuickPickItemKind.Separator is -1 in the VS Code API
    const separators = items.filter((i) => i.kind === -1);
    expect(separators.length).toBe(3); // Awaiting Input, Performing, Completed
    expect(separators[0].label).toBe('Awaiting Input');
    expect(separators[1].label).toBe('Performing');
    expect(separators[2].label).toBe('Completed');
  });

  it('merges thinking and working into the same Performing separator', () => {
    const sessions = [
      makeSession({ status: 'working', sessionId: 'a1' }),
      makeSession({ status: 'thinking', sessionId: 'a2' }),
    ];

    const items = buildQuickPickItems(sessions);

    // Should be: [Performing separator, working item, thinking item]
    const separators = items.filter((i) => i.kind === -1);
    expect(separators.length).toBe(1);
    expect(separators[0].label).toBe('Performing');
  });

  it('stores sessionId in item for selection lookup', () => {
    const sessions = [makeSession({ sessionId: 'sess-xyz', status: 'idle' })];
    const items = buildQuickPickItems(sessions);

    const sessionItem = items.find((i) => i.sessionId !== undefined);
    expect(sessionItem).toBeDefined();
    expect(sessionItem!.sessionId).toBe('sess-xyz');
  });

  it('includes relative time in description', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const sessions = [makeSession({ status: 'idle', lastActivityAt: fiveMinAgo })];
    const items = buildQuickPickItems(sessions);

    const sessionItem = items.find((i) => i.sessionId !== undefined);
    expect(sessionItem!.description).toBe('5m');
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
