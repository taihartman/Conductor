import { describe, it, expect } from 'vitest';
import { UsagePanel } from '../../webview-ui/src/components/UsagePanel';

describe('UsagePanel', () => {
  it('exports a function component', () => {
    expect(typeof UsagePanel).toBe('function');
  });

  it('returns a React element when called with null stats', () => {
    const element = UsagePanel({ stats: null });
    expect(element).toBeDefined();
    expect(element.type).toBe('div');
  });

  it('returns a React element when called with populated stats', () => {
    const stats = {
      version: 1,
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
    };

    const element = UsagePanel({ stats });
    expect(element).toBeDefined();
    expect(element.type).toBe('div');
    // With populated stats, it should have children (sections)
    expect(element.props.children).toBeDefined();
  });
});
