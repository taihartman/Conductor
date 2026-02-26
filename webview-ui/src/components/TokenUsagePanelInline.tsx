import React from 'react';
import type { TokenSummary } from '@shared/types';
import { formatTokens, formatCost, formatModel } from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';

interface TokenUsagePanelInlineProps {
  tokenSummaries: TokenSummary[];
}

export function TokenUsagePanelInline({
  tokenSummaries,
}: TokenUsagePanelInlineProps): React.ReactElement {
  if (tokenSummaries.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-xl)',
          textAlign: 'center',
          color: 'var(--fg-muted)',
          fontSize: '12px', // inline-ok
        }}
      >
        {UI_STRINGS.TOKEN_USAGE_EMPTY}
      </div>
    );
  }

  const totalInput = tokenSummaries.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = tokenSummaries.reduce((s, t) => s + t.outputTokens, 0);
  const totalCacheRead = tokenSummaries.reduce((s, t) => s + t.cacheReadTokens, 0);
  const totalCost = tokenSummaries.reduce((s, t) => s + t.estimatedCostUsd, 0);

  return (
    <div style={{ padding: 'var(--spacing-sm)', overflowY: 'auto' }}>
      {/* Summary row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: 'var(--spacing-sm)',
          textAlign: 'center',
          padding: 'var(--spacing-sm)',
          borderBottom: '1px solid var(--border)',
          marginBottom: 'var(--spacing-sm)',
        }}
      >
        <TokenStat label={UI_STRINGS.TOKEN_STAT_INPUT} value={totalInput} />
        <TokenStat label={UI_STRINGS.TOKEN_STAT_OUTPUT} value={totalOutput} />
        <TokenStat label={UI_STRINGS.TOKEN_STAT_CACHE} value={totalCacheRead} />
        <div>
          <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '2px' }}> // inline-ok
            {UI_STRINGS.TOKEN_STAT_COST}
          </div>
          <div
            style={{
              fontSize: '14px', // inline-ok
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: totalCost > 1 ? COLORS.HIGH_COST_WARNING : 'var(--fg-primary)',
            }}
          >
            {formatCost(totalCost)}
          </div>
        </div>
      </div>

      {/* Per-model breakdown */}
      {tokenSummaries.map((ts) => (
        <div
          key={`${ts.sessionId}-${ts.model}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '2px var(--spacing-xs)',
            fontSize: '11px', // inline-ok
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--fg-secondary)',
              maxWidth: '120px', // inline-ok
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={ts.model}
          >
            {formatModel(ts.model)}
          </span>
          <span style={{ color: 'var(--fg-muted)', fontSize: '10px' }}> // inline-ok
            {formatTokens(ts.inputTokens + ts.outputTokens)} tokens
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--fg-primary)',
            }}
          >
            {formatCost(ts.estimatedCostUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TokenStat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div>
      <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '2px' }}> // inline-ok
        {label}
      </div>
      <div
        style={{
          fontSize: '14px', // inline-ok
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-primary)',
        }}
      >
        {formatTokens(value)}
      </div>
    </div>
  );
}
