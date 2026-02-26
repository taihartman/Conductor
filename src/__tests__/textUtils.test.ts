import { describe, it, expect } from 'vitest';
import { extractSessionName, extractPlanTitle } from '../utils/textUtils';

describe('extractSessionName', () => {
  it('returns short text as-is', () => {
    expect(extractSessionName('Fix the login bug')).toBe('Fix the login bug');
  });

  it('extracts first sentence ending with period', () => {
    expect(extractSessionName('Fix the login bug. Also update the tests.')).toBe(
      'Fix the login bug.'
    );
  });

  it('extracts first sentence ending with exclamation', () => {
    expect(extractSessionName('Help me fix this! Its really broken')).toBe('Help me fix this!');
  });

  it('extracts first sentence ending with question mark', () => {
    expect(extractSessionName('Can you fix the login? It crashes on submit')).toBe(
      'Can you fix the login?'
    );
  });

  it('uses only the first line of multi-line input', () => {
    expect(extractSessionName('First line only\nSecond line ignored')).toBe('First line only');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(extractSessionName('   ')).toBe('');
    expect(extractSessionName('\n\n')).toBe('');
  });

  it('truncates at word boundary for text exceeding max length', () => {
    const longText =
      'This is a very long prompt that exceeds the maximum allowed character count and should be truncated at a word boundary to keep it readable';
    const result = extractSessionName(longText, 50);
    expect(result.length).toBeLessThanOrEqual(53); // 50 + '...'
    expect(result).toMatch(/\.\.\.$/);
    expect(result).not.toMatch(/\s\.\.\.$/); // no trailing space before ellipsis
  });

  it('truncates at max length when no sentence boundary', () => {
    const longNoSentence = 'a '.repeat(60); // 120 chars, no sentence boundary
    const result = extractSessionName(longNoSentence.trim());
    expect(result.length).toBeLessThanOrEqual(103); // 100 + '...'
  });

  it('respects custom maxLen parameter', () => {
    const result = extractSessionName(
      'This is a longer piece of text that should be truncated',
      20
    );
    expect(result.length).toBeLessThanOrEqual(23); // 20 + '...'
  });
});

describe('extractPlanTitle', () => {
  it('extracts title from valid H1 heading', () => {
    expect(extractPlanTitle('# My Plan')).toBe('My Plan');
  });

  it('strips "Plan:" prefix', () => {
    expect(extractPlanTitle('# Plan: Fix the Login Bug')).toBe('Fix the Login Bug');
  });

  it('strips "Implementation Plan:" prefix', () => {
    expect(extractPlanTitle('# Implementation Plan: Refactor Auth')).toBe('Refactor Auth');
  });

  it('strips "Plan to implement" prefix', () => {
    expect(extractPlanTitle('# Plan to implement dark mode')).toBe('dark mode');
  });

  it('returns undefined for non-H1 line', () => {
    expect(extractPlanTitle('Not a heading')).toBeUndefined();
    expect(extractPlanTitle('## H2 heading')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractPlanTitle('')).toBeUndefined();
  });

  it('returns undefined for H1 with only prefix', () => {
    expect(extractPlanTitle('# Plan:')).toBeUndefined();
  });

  it('returns undefined for H1 with empty content', () => {
    expect(extractPlanTitle('# ')).toBeUndefined();
  });
});
