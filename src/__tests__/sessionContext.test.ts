import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getContextText } from '../../webview-ui/src/utils/sessionContext';
import type { SessionInfo } from '../../src/models/types';

/** Minimal SessionInfo factory for tests. */
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

describe('getContextText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns tool name + input for working status with tool', () => {
    const session = makeSession({
      status: 'working',
      lastToolName: 'Read',
      lastToolInput: 'src/index.ts',
    });
    expect(getContextText(session)).toBe('Read \u2014 src/index.ts');
  });

  it('returns tool name alone for working status with tool but no input', () => {
    const session = makeSession({
      status: 'working',
      lastToolName: 'Bash',
    });
    expect(getContextText(session)).toBe('Bash');
  });

  it('returns fallback for working status with no tool', () => {
    const session = makeSession({ status: 'working' });
    expect(getContextText(session)).toBe('Working...');
  });

  it('returns thinking text for thinking status', () => {
    const session = makeSession({ status: 'thinking' });
    expect(getContextText(session)).toBe('Thinking...');
  });

  it('returns question text for waiting with pendingQuestion', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: 'Which approach?',
        options: [],
        multiSelect: false,
      },
    });
    expect(getContextText(session)).toBe('Which approach?');
  });

  it('truncates long question text at 80 chars', () => {
    const longQuestion = 'A'.repeat(100);
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: longQuestion,
        options: [],
        multiSelect: false,
      },
    });
    const result = getContextText(session);
    expect(result).toBe('A'.repeat(80) + '...');
  });

  it('returns tool approval text for waiting with tool approval', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: '',
        options: [],
        multiSelect: false,
        isToolApproval: true,
        pendingTools: [{ toolName: 'Bash', inputSummary: 'npm test' }],
      },
    });
    expect(getContextText(session)).toContain('Waiting for tool approval');
    expect(getContextText(session)).toContain('Bash \u2014 npm test');
  });

  it('returns plan approval text for enter plan mode', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: '',
        options: [],
        multiSelect: false,
        isPlanApproval: true,
        planMode: 'enter',
      },
    });
    expect(getContextText(session)).toBe('Asking to enter plan mode');
  });

  it('returns plan approval text for exit plan mode', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: '',
        options: [],
        multiSelect: false,
        isPlanApproval: true,
        planMode: 'exit',
      },
    });
    expect(getContextText(session)).toBe('Plan ready for approval');
  });

  it('returns error text for error status', () => {
    const session = makeSession({ status: 'error' });
    expect(getContextText(session)).toContain('Stuck');
  });

  it('returns lastAssistantText for done status when available', () => {
    const session = makeSession({
      status: 'done',
      lastAssistantText: 'Here is the result',
    });
    expect(getContextText(session)).toBe('Here is the result');
  });

  it('returns time ago for done status without lastAssistantText', () => {
    const session = makeSession({
      status: 'done',
      lastActivityAt: '2026-02-25T11:55:00Z',
    });
    expect(getContextText(session)).toContain('5m ago');
  });

  it('returns time ago for idle status', () => {
    const session = makeSession({
      status: 'idle',
      lastActivityAt: '2026-02-25T11:00:00Z',
    });
    expect(getContextText(session)).toBe('1h ago');
  });
});
