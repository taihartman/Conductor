import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Global stubs (before module import) ─────────────────────── */

let mockReducedMotion = false;
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('prefers-reduced-motion') ? mockReducedMotion : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

import {
  shouldNudge,
  shouldAutoZen,
  prefersReducedMotion,
} from '../../webview-ui/src/hooks/useZenNudge';
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

describe('shouldNudge', () => {
  const THRESHOLD = 45_000;

  it('returns false when no sessions exist', () => {
    const now = Date.now();
    expect(shouldNudge([], now - 60_000, THRESHOLD, now)).toBe(false);
  });

  it('returns false when agents are busy but user is not idle long enough', () => {
    const now = Date.now();
    const sessions = [makeSession({ status: 'working' })];
    // Last interaction was just 10s ago
    expect(shouldNudge(sessions, now - 10_000, THRESHOLD, now)).toBe(false);
  });

  it('returns true when all agents busy AND user idle past threshold', () => {
    const now = Date.now();
    const sessions = [
      makeSession({ sessionId: 'a', status: 'working' }),
      makeSession({ sessionId: 'b', status: 'thinking' }),
    ];
    expect(shouldNudge(sessions, now - 50_000, THRESHOLD, now)).toBe(true);
  });

  it('returns false when not all parent sessions are busy', () => {
    const now = Date.now();
    const sessions = [
      makeSession({ sessionId: 'a', status: 'working' }),
      makeSession({ sessionId: 'b', status: 'idle' }),
    ];
    expect(shouldNudge(sessions, now - 50_000, THRESHOLD, now)).toBe(false);
  });

  it('ignores sub-agent sessions when checking busy state', () => {
    const now = Date.now();
    const sessions = [
      makeSession({ sessionId: 'parent', status: 'working' }),
      makeSession({ sessionId: 'child', status: 'idle', isSubAgent: true }),
    ];
    // Only parent is considered — it's busy, so nudge should activate
    expect(shouldNudge(sessions, now - 50_000, THRESHOLD, now)).toBe(true);
  });

  it('returns false when sessions include waiting status', () => {
    const now = Date.now();
    const sessions = [makeSession({ sessionId: 'a', status: 'waiting' })];
    expect(shouldNudge(sessions, now - 50_000, THRESHOLD, now)).toBe(false);
  });

  it('returns false at exactly the threshold boundary', () => {
    const now = Date.now();
    const sessions = [makeSession({ status: 'working' })];
    // Exactly at threshold — should be true (>=)
    expect(shouldNudge(sessions, now - THRESHOLD, THRESHOLD, now)).toBe(true);
    // Just under threshold — should be false
    expect(shouldNudge(sessions, now - THRESHOLD + 1, THRESHOLD, now)).toBe(false);
  });

  it('works with custom threshold', () => {
    const now = Date.now();
    const sessions = [makeSession({ status: 'working' })];
    const customThreshold = 10_000;
    expect(shouldNudge(sessions, now - 15_000, customThreshold, now)).toBe(true);
    expect(shouldNudge(sessions, now - 5_000, customThreshold, now)).toBe(false);
  });
});

describe('shouldAutoZen', () => {
  const THRESHOLD = 300_000;
  const COOLDOWN = 300_000;

  it('returns true when idle past threshold and zenExitedAt is null', () => {
    const now = Date.now();
    expect(shouldAutoZen(now - 400_000, THRESHOLD, null, COOLDOWN, now)).toBe(true);
  });

  it('returns false when idle time is below threshold', () => {
    const now = Date.now();
    expect(shouldAutoZen(now - 100_000, THRESHOLD, null, COOLDOWN, now)).toBe(false);
  });

  it('returns false when within cooldown after exit', () => {
    const now = Date.now();
    const exitedAt = now - 60_000; // exited 1 min ago, cooldown is 5 min
    expect(shouldAutoZen(now - 400_000, THRESHOLD, exitedAt, COOLDOWN, now)).toBe(false);
  });

  it('returns true after cooldown expires', () => {
    const now = Date.now();
    const exitedAt = now - 400_000; // exited 6m40s ago, cooldown is 5 min
    expect(shouldAutoZen(now - 400_000, THRESHOLD, exitedAt, COOLDOWN, now)).toBe(true);
  });

  it('boundary: returns true at exactly threshold, false just under', () => {
    const now = Date.now();
    expect(shouldAutoZen(now - THRESHOLD, THRESHOLD, null, COOLDOWN, now)).toBe(true);
    expect(shouldAutoZen(now - THRESHOLD + 1, THRESHOLD, null, COOLDOWN, now)).toBe(false);
  });

  it('returns true when zenExitedAt is explicitly null', () => {
    const now = Date.now();
    expect(shouldAutoZen(now - 500_000, THRESHOLD, null, COOLDOWN, now)).toBe(true);
  });
});

describe('prefersReducedMotion', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it('returns false when reduced motion is not preferred', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns true when reduced motion is preferred', () => {
    mockReducedMotion = true;
    expect(prefersReducedMotion()).toBe(true);
  });
});
