import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatModel,
  formatTokens,
  formatCost,
  formatCostCompact,
  timeAgo,
  formatDuration,
  getSessionDisplayName,
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
