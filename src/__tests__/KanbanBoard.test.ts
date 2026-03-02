import { describe, it, expect } from 'vitest';
import {
  groupSessionsByColumn,
  sortColumnSessions,
  getOrderedColumns,
  getVisibleColumns,
  VERTICAL_COLUMN_ORDER,
} from '../../webview-ui/src/components/KanbanBoard';
import type { SessionInfo } from '../../src/models/types';

function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'test-session',
    slug: 'test',
    summary: '',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    gitBranch: 'main',
    cwd: '/tmp',
    startedAt: '2026-02-25T12:00:00Z',
    lastActivityAt: '2026-02-25T12:00:00Z',
    turnCount: 0,
    toolCallCount: 0,
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

describe('groupSessionsByColumn', () => {
  it('groups working sessions into performing column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'working' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['a']);
    expect(result.get('awaiting')!).toHaveLength(0);
    expect(result.get('error')!).toHaveLength(0);
    expect(result.get('completed')!).toHaveLength(0);
  });

  it('groups thinking sessions into performing column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'thinking' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('groups waiting sessions into awaiting column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'waiting' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('awaiting')!.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('groups error sessions into error column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'error' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('error')!.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('groups done and idle sessions into completed column', () => {
    const sessions = [
      makeSession({ sessionId: 'a', status: 'done' }),
      makeSession({ sessionId: 'b', status: 'idle' }),
    ];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['a', 'b']);
  });

  it('distributes mixed sessions to correct columns', () => {
    const sessions = [
      makeSession({ sessionId: 'a', status: 'working' }),
      makeSession({ sessionId: 'b', status: 'waiting' }),
      makeSession({ sessionId: 'c', status: 'error' }),
      makeSession({ sessionId: 'd', status: 'done' }),
      makeSession({ sessionId: 'e', status: 'thinking' }),
    ];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['a', 'e']);
    expect(result.get('awaiting')!.map((s) => s.sessionId)).toEqual(['b']);
    expect(result.get('error')!.map((s) => s.sessionId)).toEqual(['c']);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['d']);
  });

  it('returns empty arrays for all columns when no sessions', () => {
    const result = groupSessionsByColumn([]);
    expect(result.get('performing')!).toHaveLength(0);
    expect(result.get('awaiting')!).toHaveLength(0);
    expect(result.get('error')!).toHaveLength(0);
    expect(result.get('completed')!).toHaveLength(0);
  });

  it('places sessions with unrecognized status in completed (fallback) column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'unknown' as any })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['a']);
  });
});

describe('sortColumnSessions', () => {
  it('sorts sessions by lastActivityAt descending (most recent first) by default', () => {
    const grouped = new Map<string, SessionInfo[]>([
      [
        'performing',
        [
          makeSession({ sessionId: 'old', lastActivityAt: '2026-02-25T10:00:00Z' }),
          makeSession({ sessionId: 'newest', lastActivityAt: '2026-02-25T14:00:00Z' }),
          makeSession({ sessionId: 'mid', lastActivityAt: '2026-02-25T12:00:00Z' }),
        ],
      ],
    ]);
    const result = sortColumnSessions(grouped);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['newest', 'mid', 'old']);
  });

  it('preserves order for sessions with identical lastActivityAt', () => {
    const timestamp = '2026-02-25T12:00:00Z';
    const grouped = new Map<string, SessionInfo[]>([
      [
        'completed',
        [
          makeSession({ sessionId: 'first', lastActivityAt: timestamp }),
          makeSession({ sessionId: 'second', lastActivityAt: timestamp }),
          makeSession({ sessionId: 'third', lastActivityAt: timestamp }),
        ],
      ],
    ]);
    const result = sortColumnSessions(grouped);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['first', 'second', 'third']);
  });

  it('handles empty column without error', () => {
    const grouped = new Map<string, SessionInfo[]>([['awaiting', []]]);
    const result = sortColumnSessions(grouped);
    expect(result.get('awaiting')!).toHaveLength(0);
  });

  it('sorts ascending when column direction is asc', () => {
    const grouped = new Map<string, SessionInfo[]>([
      [
        'performing',
        [
          makeSession({ sessionId: 'newest', lastActivityAt: '2026-02-25T14:00:00Z' }),
          makeSession({ sessionId: 'old', lastActivityAt: '2026-02-25T10:00:00Z' }),
          makeSession({ sessionId: 'mid', lastActivityAt: '2026-02-25T12:00:00Z' }),
        ],
      ],
    ]);
    const result = sortColumnSessions(grouped, { performing: 'asc' });
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['old', 'mid', 'newest']);
  });

  it('supports mixed sort directions across columns', () => {
    const grouped = new Map<string, SessionInfo[]>([
      [
        'performing',
        [
          makeSession({ sessionId: 'p-old', lastActivityAt: '2026-02-25T10:00:00Z' }),
          makeSession({ sessionId: 'p-new', lastActivityAt: '2026-02-25T14:00:00Z' }),
        ],
      ],
      [
        'completed',
        [
          makeSession({ sessionId: 'c-old', lastActivityAt: '2026-02-25T08:00:00Z' }),
          makeSession({ sessionId: 'c-new', lastActivityAt: '2026-02-25T16:00:00Z' }),
        ],
      ],
    ]);
    const result = sortColumnSessions(grouped, { performing: 'asc', completed: 'desc' });
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['p-old', 'p-new']);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['c-new', 'c-old']);
  });

  it('defaults to desc for columns missing from sortOrders (backwards compatible)', () => {
    const grouped = new Map<string, SessionInfo[]>([
      [
        'awaiting',
        [
          makeSession({ sessionId: 'old', lastActivityAt: '2026-02-25T10:00:00Z' }),
          makeSession({ sessionId: 'new', lastActivityAt: '2026-02-25T14:00:00Z' }),
        ],
      ],
    ]);
    // Empty sortOrders — should default to desc
    const result = sortColumnSessions(grouped, {});
    expect(result.get('awaiting')!.map((s) => s.sessionId)).toEqual(['new', 'old']);
  });

  it('toggling twice restores original descending order', () => {
    const grouped = new Map<string, SessionInfo[]>([
      [
        'performing',
        [
          makeSession({ sessionId: 'old', lastActivityAt: '2026-02-25T10:00:00Z' }),
          makeSession({ sessionId: 'new', lastActivityAt: '2026-02-25T14:00:00Z' }),
        ],
      ],
    ]);
    const descResult = sortColumnSessions(grouped, { performing: 'desc' });
    const ascResult = sortColumnSessions(grouped, { performing: 'asc' });
    const backToDesc = sortColumnSessions(grouped, { performing: 'desc' });
    expect(descResult.get('performing')!.map((s) => s.sessionId)).toEqual(['new', 'old']);
    expect(ascResult.get('performing')!.map((s) => s.sessionId)).toEqual(['old', 'new']);
    expect(backToDesc.get('performing')!.map((s) => s.sessionId)).toEqual(
      descResult.get('performing')!.map((s) => s.sessionId)
    );
  });
});

describe('getOrderedColumns (vertical layout ordering)', () => {
  it('returns horizontal order when not vertical', () => {
    const columns = getOrderedColumns(false);
    expect(columns.map((c) => c.key)).toEqual(['performing', 'awaiting', 'error', 'completed']);
  });

  it('returns priority order when vertical', () => {
    const columns = getOrderedColumns(true);
    expect(columns.map((c) => c.key)).toEqual([...VERTICAL_COLUMN_ORDER]);
  });

  it('VERTICAL_COLUMN_ORDER prioritizes needs-attention first', () => {
    expect(VERTICAL_COLUMN_ORDER[0]).toBe('error');
  });
});

describe('getVisibleColumns (empty-row filtering)', () => {
  it('returns all columns in horizontal mode even when empty', () => {
    const columns = getOrderedColumns(false);
    const grouped = new Map<string, SessionInfo[]>([
      ['performing', []],
      ['awaiting', []],
      ['error', []],
      ['completed', []],
    ]);
    const visible = getVisibleColumns(columns, grouped, false);
    expect(visible.map((c) => c.key)).toEqual(['performing', 'awaiting', 'error', 'completed']);
  });

  it('excludes empty columns in vertical mode', () => {
    const columns = getOrderedColumns(true);
    const grouped = new Map<string, SessionInfo[]>([
      ['performing', [makeSession({ sessionId: 'a', status: 'working' })]],
      ['awaiting', []],
      ['error', [makeSession({ sessionId: 'b', status: 'error' })]],
      ['completed', []],
    ]);
    const visible = getVisibleColumns(columns, grouped, true);
    expect(visible.map((c) => c.key)).toEqual(['error', 'performing']);
  });

  it('returns no columns when all are empty in vertical mode', () => {
    const columns = getOrderedColumns(true);
    const grouped = new Map<string, SessionInfo[]>([
      ['performing', []],
      ['awaiting', []],
      ['error', []],
      ['completed', []],
    ]);
    const visible = getVisibleColumns(columns, grouped, true);
    expect(visible).toHaveLength(0);
  });
});

describe('launching sessions with overridden working status', () => {
  it('groups launching sessions (status overridden to working) into performing column', () => {
    // When ConductorDashboard remaps a launching session status to "working",
    // KanbanBoard should place it in the "performing" column
    const sessions = [
      makeSession({
        sessionId: 'launching-1',
        status: 'working',
        launchedByConductor: true,
        turnCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }),
    ];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['launching-1']);
    expect(result.get('completed')!).toHaveLength(0);
  });
});
