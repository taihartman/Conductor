import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatModel,
  formatTokens,
  formatCost,
  formatCostCompact,
  timeAgo,
  formatDuration,
  formatDurationHuman,
  formatDateShort,
  formatNumber,
  getSessionDisplayName,
  formatUserMessage,
} from '../../webview-ui/src/utils/formatters';

describe('formatModel', () => {
  it('returns Opus for opus models', () => {
    expect(formatModel('claude-opus-4-6')).toBe('Opus');
  });

  it('returns Sonnet for sonnet models', () => {
    expect(formatModel('claude-sonnet-4-6')).toBe('Sonnet');
  });

  it('returns Haiku for haiku models', () => {
    expect(formatModel('claude-haiku-4-5')).toBe('Haiku');
  });

  it('returns last segment for unknown models', () => {
    expect(formatModel('some-unknown-model')).toBe('model');
  });

  it('returns the string itself when no dashes', () => {
    expect(formatModel('gpt4')).toBe('gpt4');
  });
});

describe('formatTokens', () => {
  it('returns raw number for small values', () => {
    expect(formatTokens(500)).toBe('500');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1_500)).toBe('1.5K');
    expect(formatTokens(1_000)).toBe('1.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });

  it('returns 0 for zero', () => {
    expect(formatTokens(0)).toBe('0');
  });
});

describe('formatCost', () => {
  it('returns $0.00 for zero', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('shows 4 decimal places for sub-cent amounts', () => {
    expect(formatCost(0.0034)).toBe('$0.0034');
  });

  it('shows 3 decimal places for sub-dollar amounts', () => {
    expect(formatCost(0.123)).toBe('$0.123');
  });

  it('shows 2 decimal places for dollar+ amounts', () => {
    expect(formatCost(5.678)).toBe('$5.68');
  });
});

describe('formatCostCompact', () => {
  it('returns empty string for zero', () => {
    expect(formatCostCompact(0)).toBe('');
  });

  it('returns <$0.01 for tiny amounts', () => {
    expect(formatCostCompact(0.001)).toBe('<$0.01');
    expect(formatCostCompact(0.009)).toBe('<$0.01');
  });

  it('returns formatted dollar amount for larger values', () => {
    expect(formatCostCompact(1.234)).toBe('$1.23');
    expect(formatCostCompact(0.05)).toBe('$0.05');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns seconds ago for recent timestamps', () => {
    expect(timeAgo('2026-02-25T11:59:30Z')).toBe('30s ago');
  });

  it('returns minutes ago', () => {
    expect(timeAgo('2026-02-25T11:55:00Z')).toBe('5m ago');
  });

  it('returns hours ago', () => {
    expect(timeAgo('2026-02-25T09:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    expect(timeAgo('2026-02-23T12:00:00Z')).toBe('2d ago');
  });
});

describe('formatDuration', () => {
  it('returns milliseconds for sub-second durations', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('returns seconds for longer durations', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(1000)).toBe('1.0s');
  });
});

describe('formatDurationHuman', () => {
  it('returns <1m for sub-minute durations', () => {
    expect(formatDurationHuman(0)).toBe('<1m');
    expect(formatDurationHuman(30_000)).toBe('<1m');
    expect(formatDurationHuman(59_999)).toBe('<1m');
  });

  it('returns minutes only when under one hour', () => {
    expect(formatDurationHuman(60_000)).toBe('1m');
    expect(formatDurationHuman(300_000)).toBe('5m');
    expect(formatDurationHuman(59 * 60_000)).toBe('59m');
  });

  it('returns hours and minutes', () => {
    expect(formatDurationHuman(6 * 3_600_000 + 40 * 60_000)).toBe('6h 40m');
  });

  it('returns hours only when minutes are zero', () => {
    expect(formatDurationHuman(2 * 3_600_000)).toBe('2h');
  });

  it('returns days and hours', () => {
    expect(formatDurationHuman(27 * 86_400_000 + 19 * 3_600_000)).toBe('27d 19h');
  });

  it('returns days only when hours are zero', () => {
    expect(formatDurationHuman(3 * 86_400_000)).toBe('3d');
  });
});

describe('formatDateShort', () => {
  it('formats ISO date as short weekday + day', () => {
    // 2026-02-27 is a Friday
    expect(formatDateShort('2026-02-27')).toBe('Fri 27');
  });

  it('handles single-digit days', () => {
    // 2026-03-01 is a Sunday
    expect(formatDateShort('2026-03-01')).toBe('Sun 1');
  });
});

describe('formatNumber', () => {
  it('returns "0" for zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats small numbers without grouping', () => {
    expect(formatNumber(42)).toBe('42');
  });

  it('adds locale grouping for thousands', () => {
    expect(formatNumber(1_541)).toBe('1,541');
    expect(formatNumber(1_000_000)).toBe('1,000,000');
  });
});

describe('getSessionDisplayName', () => {
  it('returns customName when set', () => {
    expect(
      getSessionDisplayName({ customName: 'My Session', autoName: 'Fix bug', slug: 'abc-123' })
    ).toBe('My Session');
  });

  it('returns autoName when customName not set', () => {
    expect(getSessionDisplayName({ autoName: 'Fix the login bug', slug: 'abc-123' })).toBe(
      'Fix the login bug'
    );
  });

  it('returns slug when neither customName nor autoName set', () => {
    expect(getSessionDisplayName({ slug: 'abc-123' })).toBe('abc-123');
  });

  it('returns customName even when all three are set', () => {
    expect(
      getSessionDisplayName({
        customName: 'Custom',
        autoName: 'Auto',
        slug: 'slug-123',
      })
    ).toBe('Custom');
  });
});

describe('formatUserMessage', () => {
  it('collapses newlines and multiple spaces into single space', () => {
    expect(formatUserMessage('fix the\nlogin\n\nflow  please')).toBe('fix the login flow please');
  });

  it('trims leading and trailing whitespace', () => {
    expect(formatUserMessage('  hello world  ')).toBe('hello world');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(formatUserMessage('   \n\t  ')).toBe('');
  });

  it('passes through single-line text unchanged', () => {
    expect(formatUserMessage('simple message')).toBe('simple message');
  });
});
