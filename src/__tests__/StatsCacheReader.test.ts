import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { USAGE } from '../constants';

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

import { StatsCacheReader } from '../persistence/StatsCacheReader';

function createMockOutputChannel(): any {
  return { appendLine: vi.fn() };
}

/** Minimal valid stats-cache.json structure. */
function makeValidStatsCache(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: USAGE.SUPPORTED_CACHE_VERSION,
    lastComputedDate: '2026-02-27',
    dailyActivity: [{ date: '2026-02-27', messageCount: 10, sessionCount: 2, toolCallCount: 5 }],
    dailyModelTokens: [{ date: '2026-02-27', tokensByModel: { 'claude-opus-4-6': 1000 } }],
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 500,
        outputTokens: 300,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        webSearchRequests: 0,
      },
    },
    totalSessions: 42,
    totalMessages: 1541,
    longestSession: {
      sessionId: 'abc-123',
      duration: 24_000_000,
      messageCount: 50,
      timestamp: '2026-02-20T10:00:00Z',
    },
    firstSessionDate: '2026-01-15',
    hourCounts: { '9': 5, '10': 8, '14': 3 },
    ...overrides,
  };
}

describe('StatsCacheReader', () => {
  let outputChannel: ReturnType<typeof createMockOutputChannel>;

  beforeEach(() => {
    outputChannel = createMockOutputChannel();
    vi.restoreAllMocks();
  });

  it('reads and parses a valid stats-cache.json', async () => {
    const data = makeValidStatsCache();
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(data));

    const reader = new StatsCacheReader(outputChannel);
    const result = await reader.read();

    expect(result).not.toBeNull();
    expect(result!.version).toBe(USAGE.SUPPORTED_CACHE_VERSION);
    expect(result!.totalSessions).toBe(42);
    expect(result!.totalMessages).toBe(1541);
    expect(result!.dailyActivity).toHaveLength(1);
    expect(result!.modelUsage['claude-opus-4-6'].inputTokens).toBe(500);
  });

  it('returns null when file does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

    const reader = new StatsCacheReader(outputChannel);
    const result = await reader.read();

    expect(result).toBeNull();
    // Should not log to output channel for ENOENT (expected case)
    expect(outputChannel.appendLine).not.toHaveBeenCalled();
  });

  it('returns null on corrupt JSON', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{ not valid json');

    const reader = new StatsCacheReader(outputChannel);
    const result = await reader.read();

    expect(result).toBeNull();
    expect(outputChannel.appendLine).toHaveBeenCalled();
  });

  it('logs warning for unexpected version but still returns data', async () => {
    const data = makeValidStatsCache({ version: 99 });
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(data));

    const reader = new StatsCacheReader(outputChannel);
    const result = await reader.read();

    expect(result).not.toBeNull();
    expect(result!.version).toBe(99);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected stats-cache version: 99')
    );
  });
});
