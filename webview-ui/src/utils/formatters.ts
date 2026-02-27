/**
 * Shared formatting utilities for the webview UI.
 *
 * All display formatting logic lives here to avoid duplication across components.
 */

export function formatModel(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.split('-').pop() || model;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Exact cost formatting for per-model precision (e.g. TokenUsagePanelInline). */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Compact cost for overview contexts — empty for zero, '<$0.01' for tiny amounts. */
export function formatCostCompact(usd: number): string {
  if (usd === 0) return '';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format milliseconds as a human-friendly duration string.
 * Returns "6h 40m" / "5m" / "2h" / "27d 19h" / "<1m".
 */
export function formatDurationHuman(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return '<1m';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Format an ISO date string as "Mon 27" (short weekday + day). */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday} ${date.getDate()}`;
}

/** Format a number with locale grouping (e.g. "1,541"). */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Format an ISO date string as "Dec 2, 2025" (month day, year). Falls back to raw string on invalid input. */
export function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Aggregate model usage entries by display name.
 * Models that map to the same display name (e.g. two Opus variants) have their token counts summed.
 */
export function aggregateModelUsage(
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      webSearchRequests: number;
    }
  >
): Record<
  string,
  {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
  }
> {
  const result: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      webSearchRequests: number;
    }
  > = {};
  for (const [model, usage] of Object.entries(modelUsage)) {
    const displayName = formatModel(model);
    const existing = result[displayName];
    if (existing) {
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.cacheReadInputTokens += usage.cacheReadInputTokens;
      existing.cacheCreationInputTokens += usage.cacheCreationInputTokens;
      existing.webSearchRequests += usage.webSearchRequests;
    } else {
      result[displayName] = { ...usage };
    }
  }
  return result;
}

/** Collapse all whitespace (including newlines) into single spaces for single-line card display. */
export function formatUserMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Display name priority: user-set custom name > auto-generated name > slug. */
export function getSessionDisplayName(session: {
  customName?: string;
  autoName?: string;
  slug: string;
}): string {
  return session.customName ?? session.autoName ?? session.slug;
}
