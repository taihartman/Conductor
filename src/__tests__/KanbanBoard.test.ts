import { describe, it, expect } from 'vitest';
import { groupSessionsByColumn } from '../../webview-ui/src/components/KanbanBoard';
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
