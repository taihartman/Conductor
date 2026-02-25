import React from 'react';
import type { TokenSummary } from '@shared/types';

interface TokenUsagePanelInlineProps {
  tokenSummaries: TokenSummary[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
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
          fontSize: '12px',
        }}
      >
        No token data available
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
        <TokenStat label="Input" value={totalInput} />
        <TokenStat label="Output" value={totalOutput} />
        <TokenStat label="Cache" value={totalCacheRead} />
        <div>
          <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '2px' }}>
            Cost
          </div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: totalCost > 1 ? '#f0ad4e' : 'var(--fg-primary)',
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
            fontSize: '11px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--fg-secondary)',
              maxWidth: '120px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={ts.model}
          >
            {ts.model.includes('opus')
              ? 'Opus'
              : ts.model.includes('sonnet')
                ? 'Sonnet'
                : ts.model.includes('haiku')
                  ? 'Haiku'
                  : ts.model}
          </span>
          <span style={{ color: 'var(--fg-muted)', fontSize: '10px' }}>
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
      <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '2px' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '14px',
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
