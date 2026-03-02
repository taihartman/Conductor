import { describe, it, expect } from 'vitest';
import { matchesSearchQuery } from '../../webview-ui/src/utils/sessionFilter';
import type { SessionInfo } from '../models/types';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'abc-123',
    slug: 'abc123',
    summary: '',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    gitBranch: 'main',
    cwd: '/home/user/project',
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnCount: 0,
    toolCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    filePath: '/tmp/test.jsonl',
    ...overrides,
  };
}

describe('matchesSearchQuery', () => {
  it('returns true for empty query', () => {
    expect(matchesSearchQuery(makeSession(), '')).toBe(true);
  });

  it('matches on customName (case-insensitive)', () => {
    const session = makeSession({ customName: 'My Auth Feature' });
    expect(matchesSearchQuery(session, 'auth')).toBe(true);
    expect(matchesSearchQuery(session, 'AUTH')).toBe(true);
    expect(matchesSearchQuery(session, 'nope')).toBe(false);
  });

  it('matches on autoName (case-insensitive)', () => {
    const session = makeSession({ autoName: 'Fix login bug' });
    expect(matchesSearchQuery(session, 'login')).toBe(true);
    expect(matchesSearchQuery(session, 'LOGIN')).toBe(true);
  });

  it('matches on slug', () => {
    const session = makeSession({ slug: 'abc123' });
    expect(matchesSearchQuery(session, 'abc')).toBe(true);
    expect(matchesSearchQuery(session, 'ABC')).toBe(true);
  });

  it('matches on model', () => {
    const session = makeSession({ model: 'claude-opus-4-6' });
    expect(matchesSearchQuery(session, 'opus')).toBe(true);
    expect(matchesSearchQuery(session, 'OPUS')).toBe(true);
  });

  it('returns false when no field matches', () => {
    const session = makeSession({
      customName: 'Feature A',
      autoName: 'Feature B',
      slug: 'def456',
      model: 'claude-sonnet-4-6',
    });
    expect(matchesSearchQuery(session, 'zzz')).toBe(false);
  });

  it('handles undefined customName without throwing', () => {
    const session = makeSession({ customName: undefined });
    expect(matchesSearchQuery(session, 'test')).toBe(false);
  });

  it('handles undefined autoName without throwing', () => {
    const session = makeSession({ autoName: undefined });
    expect(matchesSearchQuery(session, 'test')).toBe(false);
  });

  it('handles undefined model without throwing', () => {
    const session = makeSession({ model: '' });
    expect(matchesSearchQuery(session, 'opus')).toBe(false);
  });
});
