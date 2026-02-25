import { describe, it, expect } from 'vitest';
import { countCompletions } from '../../webview-ui/src/hooks/useCompletionDetector';
import type { SessionInfo } from '../models/types';

/* ── Helpers ─────────────────────────────────────────────────── */

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'test-1',
    slug: 'test1234',
    summary: '',
    status: 'working',
    model: 'claude-sonnet-4-6',
    gitBranch: 'main',
    cwd: '/tmp',
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    filePath: '/tmp/test.jsonl',
    ...overrides,
  };
}

/* ── Tests ────────────────────────────────────────────────────── */

describe('countCompletions', () => {
  it('returns 0 when prev sessions is empty', () => {
    const current = [makeSession({ status: 'done' })];
    expect(countCompletions([], current)).toBe(0);
  });

  it('detects working → done transition', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'working' })];
    const current = [makeSession({ sessionId: 'a', status: 'done' })];
    expect(countCompletions(prev, current)).toBe(1);
  });

  it('detects thinking → idle transition', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'thinking' })];
    const current = [makeSession({ sessionId: 'a', status: 'idle' })];
    expect(countCompletions(prev, current)).toBe(1);
  });

  it('detects working → idle transition', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'working' })];
    const current = [makeSession({ sessionId: 'a', status: 'idle' })];
    expect(countCompletions(prev, current)).toBe(1);
  });

  it('detects thinking → done transition', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'thinking' })];
    const current = [makeSession({ sessionId: 'a', status: 'done' })];
    expect(countCompletions(prev, current)).toBe(1);
  });

  it('returns 0 when status stays the same', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'working' })];
    const current = [makeSession({ sessionId: 'a', status: 'working' })];
    expect(countCompletions(prev, current)).toBe(0);
  });

  it('returns 0 for non-completion transitions (idle → working)', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'idle' })];
    const current = [makeSession({ sessionId: 'a', status: 'working' })];
    expect(countCompletions(prev, current)).toBe(0);
  });

  it('returns 0 for waiting → done (waiting is not an active status)', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'waiting' })];
    const current = [makeSession({ sessionId: 'a', status: 'done' })];
    expect(countCompletions(prev, current)).toBe(0);
  });

  it('handles multiple simultaneous completions', () => {
    const prev = [
      makeSession({ sessionId: 'a', status: 'working' }),
      makeSession({ sessionId: 'b', status: 'thinking' }),
    ];
    const current = [
      makeSession({ sessionId: 'a', status: 'done' }),
      makeSession({ sessionId: 'b', status: 'idle' }),
    ];
    expect(countCompletions(prev, current)).toBe(2);
  });

  it('handles empty current sessions array', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'working' })];
    expect(countCompletions(prev, [])).toBe(0);
  });

  it('handles both arrays empty', () => {
    expect(countCompletions([], [])).toBe(0);
  });

  it('ignores sessions not present in prev', () => {
    const prev = [makeSession({ sessionId: 'a', status: 'working' })];
    const current = [
      makeSession({ sessionId: 'a', status: 'done' }),
      makeSession({ sessionId: 'b', status: 'done' }),
    ];
    // Session b has no prev, so only a counts
    expect(countCompletions(prev, current)).toBe(1);
  });

  it('counts mixed results — some complete, some not', () => {
    const prev = [
      makeSession({ sessionId: 'a', status: 'working' }),
      makeSession({ sessionId: 'b', status: 'working' }),
      makeSession({ sessionId: 'c', status: 'idle' }),
    ];
    const current = [
      makeSession({ sessionId: 'a', status: 'done' }),
      makeSession({ sessionId: 'b', status: 'working' }),
      makeSession({ sessionId: 'c', status: 'working' }),
    ];
    expect(countCompletions(prev, current)).toBe(1);
  });
});
