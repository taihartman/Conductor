/**
 * @module TokenCounter
 *
 * Aggregates token usage per session and estimates USD costs using hardcoded model pricing.
 *
 * @remarks
 * Pricing is embedded in {@link MODEL_PRICING} and must be updated manually when
 * Anthropic changes rates. This is tracked as technical debt — future work will
 * move pricing to external config or VS Code settings.
 */

import { TokenUsage, TokenSummary } from '../models/types';

/** Per-model pricing rates used for cost estimation. */
interface ModelPricing {
  /** USD cost per million input tokens. */
  inputPerMillion: number;
  /** USD cost per million output tokens. */
  outputPerMillion: number;
  /** Multiplier vs input price for cache reads (e.g., 0.1 = 10% of input rate). */
  cacheReadDiscount: number;
}

/**
 * Hardcoded model pricing table.
 *
 * @remarks
 * Cache creation cost is calculated as 1.25x the input rate (25% premium).
 * Cache read cost is calculated as `inputPerMillion * cacheReadDiscount`.
 *
 * | Model | Input/M | Output/M | Cache Read/M | Cache Create/M |
 * |-------|---------|----------|--------------|----------------|
 * | Opus 4.6 | $15.00 | $75.00 | $1.50 | $18.75 |
 * | Sonnet 4.6 | $3.00 | $15.00 | $0.30 | $3.75 |
 * | Haiku 4.5 | $0.80 | $4.00 | $0.08 | $1.00 |
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadDiscount: 0.1,
  },
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadDiscount: 0.1,
  },
  'claude-haiku-4-5': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadDiscount: 0.1,
  },
  // Legacy model names
  'claude-3-5-sonnet-20241022': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadDiscount: 0.1,
  },
  'claude-3-5-haiku-20241022': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadDiscount: 0.1,
  },
};

/**
 * Resolves a model identifier to its pricing configuration.
 *
 * @remarks
 * Attempts exact match first, then partial string match, then model family
 * detection (opus/sonnet/haiku). Falls back to Sonnet pricing if no match is found.
 *
 * @param model - Model identifier from the API response (e.g., `'claude-opus-4-6'`)
 * @returns The pricing configuration for the matched model
 */
function findPricing(model: string): ModelPricing {
  // Exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Partial match
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key) || key.includes(model)) {
      return pricing;
    }
  }

  // Check for model family
  if (model.includes('opus')) {
    return MODEL_PRICING['claude-opus-4-6'];
  }
  if (model.includes('sonnet')) {
    return MODEL_PRICING['claude-sonnet-4-6'];
  }
  if (model.includes('haiku')) {
    return MODEL_PRICING['claude-haiku-4-5'];
  }

  // Default to sonnet pricing
  return MODEL_PRICING['claude-sonnet-4-6'];
}

/** Running token totals for a single session. */
export interface SessionTokenState {
  sessionId: string;
  sessionSlug: string;
  /** Most recently observed model ID. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Accumulates token usage across sessions and computes cost estimates.
 *
 * @remarks
 * Instances are owned by {@link SessionTracker}. Each assistant message's
 * {@link TokenUsage} is fed to {@link accumulate}, and the aggregated
 * summaries are retrieved via {@link getSummaries} for display in the dashboard.
 */
export class TokenCounter {
  private readonly sessions: Map<string, SessionTokenState> = new Map();

  /**
   * Add token usage from a single assistant message to the session's running total.
   *
   * @param sessionId - Unique session identifier
   * @param sessionSlug - Short display name for the session
   * @param model - Model ID from the API response
   * @param usage - Token usage counters from the assistant message
   */
  accumulate(sessionId: string, sessionSlug: string, model: string, usage: TokenUsage): void {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        sessionSlug,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      this.sessions.set(sessionId, state);
    }

    state.model = model;
    state.inputTokens += usage.input_tokens || 0;
    state.outputTokens += usage.output_tokens || 0;
    state.cacheReadTokens += usage.cache_read_input_tokens || 0;
    state.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
  }

  /**
   * Compute token summaries with cost estimates for all tracked sessions.
   *
   * @returns Array of {@link TokenSummary} objects, one per session, with
   * `estimatedCostUsd` rounded to 4 decimal places.
   */
  getSummaries(): TokenSummary[] {
    return Array.from(this.sessions.values()).map((state) => {
      const pricing = findPricing(state.model);
      const inputCost = (state.inputTokens / 1_000_000) * pricing.inputPerMillion;
      const outputCost = (state.outputTokens / 1_000_000) * pricing.outputPerMillion;
      const cacheReadCost =
        (state.cacheReadTokens / 1_000_000) * pricing.inputPerMillion * pricing.cacheReadDiscount;
      const cacheCreationCost =
        (state.cacheCreationTokens / 1_000_000) * pricing.inputPerMillion * 1.25;
      const estimatedCostUsd = inputCost + outputCost + cacheReadCost + cacheCreationCost;

      return {
        sessionId: state.sessionId,
        sessionSlug: state.sessionSlug,
        model: state.model,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cacheReadTokens: state.cacheReadTokens,
        cacheCreationTokens: state.cacheCreationTokens,
        estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      };
    });
  }

  /**
   * Retrieve the current token state for a specific session.
   *
   * @param sessionId - Session to look up
   * @returns The session's token state, or `undefined` if not tracked
   */
  getSessionTokens(sessionId: string): SessionTokenState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Estimate the USD cost for a given set of token counts and model.
   *
   * @param model - Model identifier for pricing lookup
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @param cacheReadTokens - Number of cache-read tokens (default: 0)
   * @param cacheCreationTokens - Number of cache-creation tokens (default: 0)
   * @returns Estimated cost in USD, rounded to 4 decimal places
   */
  static estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0
  ): number {
    const pricing = findPricing(model);
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    const cacheReadCost =
      (cacheReadTokens / 1_000_000) * pricing.inputPerMillion * pricing.cacheReadDiscount;
    const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.inputPerMillion * 1.25;
    return Math.round((inputCost + outputCost + cacheReadCost + cacheCreationCost) * 10000) / 10000;
  }

  /** Reset all tracked session token data. */
  clear(): void {
    this.sessions.clear();
  }
}
