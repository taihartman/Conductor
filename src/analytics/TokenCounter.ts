import { TokenUsage, TokenSummary } from '../models/types';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadDiscount: number; // multiplier vs input price (e.g., 0.1 = 10%)
}

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

export interface SessionTokenState {
  sessionId: string;
  sessionSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export class TokenCounter {
  private readonly sessions: Map<string, SessionTokenState> = new Map();

  accumulate(
    sessionId: string,
    sessionSlug: string,
    model: string,
    usage: TokenUsage
  ): void {
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

  getSummaries(): TokenSummary[] {
    return Array.from(this.sessions.values()).map((state) => {
      const pricing = findPricing(state.model);
      const inputCost =
        (state.inputTokens / 1_000_000) * pricing.inputPerMillion;
      const outputCost =
        (state.outputTokens / 1_000_000) * pricing.outputPerMillion;
      const cacheReadCost =
        (state.cacheReadTokens / 1_000_000) *
        pricing.inputPerMillion *
        pricing.cacheReadDiscount;
      const cacheCreationCost =
        (state.cacheCreationTokens / 1_000_000) * pricing.inputPerMillion * 1.25;
      const estimatedCostUsd =
        inputCost + outputCost + cacheReadCost + cacheCreationCost;

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

  getSessionTokens(sessionId: string): SessionTokenState | undefined {
    return this.sessions.get(sessionId);
  }

  static estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0
  ): number {
    const pricing = findPricing(model);
    const inputCost =
      (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost =
      (outputTokens / 1_000_000) * pricing.outputPerMillion;
    const cacheReadCost =
      (cacheReadTokens / 1_000_000) *
      pricing.inputPerMillion *
      pricing.cacheReadDiscount;
    const cacheCreationCost =
      (cacheCreationTokens / 1_000_000) * pricing.inputPerMillion * 1.25;
    return Math.round((inputCost + outputCost + cacheReadCost + cacheCreationCost) * 10000) / 10000;
  }

  clear(): void {
    this.sessions.clear();
  }
}
