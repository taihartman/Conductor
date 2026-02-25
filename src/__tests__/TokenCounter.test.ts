import { describe, it, expect, beforeEach } from 'vitest';
import { TokenCounter } from '../analytics/TokenCounter';

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter();
  });

  it('accumulates tokens for a session', () => {
    counter.accumulate('s1', 'test-slug', 'claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 3000,
    });

    counter.accumulate('s1', 'test-slug', 'claude-sonnet-4-6', {
      input_tokens: 500,
      output_tokens: 100,
      cache_read_input_tokens: 8000,
      cache_creation_input_tokens: 0,
    });

    const summaries = counter.getSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].inputTokens).toBe(1500);
    expect(summaries[0].outputTokens).toBe(300);
    expect(summaries[0].cacheReadTokens).toBe(13000);
    expect(summaries[0].cacheCreationTokens).toBe(3000);
  });

  it('tracks multiple sessions separately', () => {
    counter.accumulate('s1', 'slug-1', 'claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 200,
    });

    counter.accumulate('s2', 'slug-2', 'claude-opus-4-6', {
      input_tokens: 2000,
      output_tokens: 500,
    });

    const summaries = counter.getSummaries();
    expect(summaries).toHaveLength(2);

    const s1 = summaries.find((s) => s.sessionId === 's1')!;
    const s2 = summaries.find((s) => s.sessionId === 's2')!;
    expect(s1.inputTokens).toBe(1000);
    expect(s2.inputTokens).toBe(2000);
  });

  it('estimates cost for sonnet model', () => {
    // Sonnet: $3/M input, $15/M output, cache read at 10% of input
    counter.accumulate('s1', 'slug', 'claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });

    const summaries = counter.getSummaries();
    const cost = summaries[0].estimatedCostUsd;

    // input: $3 + output: $15 + cache_read: $0.30 + cache_creation: $3.75 = $22.05
    expect(cost).toBeCloseTo(22.05, 1);
  });

  it('estimates cost for opus model', () => {
    // Opus: $15/M input, $75/M output
    counter.accumulate('s1', 'slug', 'claude-opus-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
    });

    const summaries = counter.getSummaries();
    const cost = summaries[0].estimatedCostUsd;
    // input: $15 + output: $7.50 = $22.50
    expect(cost).toBeCloseTo(22.5, 1);
  });

  it('estimates cost for haiku model', () => {
    counter.accumulate('s1', 'slug', 'claude-haiku-4-5', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });

    const summaries = counter.getSummaries();
    const cost = summaries[0].estimatedCostUsd;
    // input: $0.80 + output: $4 = $4.80
    expect(cost).toBeCloseTo(4.8, 1);
  });

  it('handles unknown model gracefully', () => {
    counter.accumulate('s1', 'slug', 'claude-unknown-model', {
      input_tokens: 1000,
      output_tokens: 500,
    });

    const summaries = counter.getSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  it('static estimateCost works', () => {
    const cost = TokenCounter.estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
    // input: $3 + output: $15 = $18
    expect(cost).toBeCloseTo(18, 1);
  });

  it('handles cache variants in cost estimation', () => {
    const costWithCache = TokenCounter.estimateCost(
      'claude-sonnet-4-6',
      100_000,
      50_000,
      500_000, // cache read
      200_000 // cache creation
    );

    const costWithoutCache = TokenCounter.estimateCost('claude-sonnet-4-6', 100_000, 50_000);

    // Cache should add cost (cache creation at 125% and cache read at 10%)
    expect(costWithCache).toBeGreaterThan(costWithoutCache);
  });
});
