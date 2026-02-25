import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';

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

export function TokenUsagePanel(): React.ReactElement {
  const tokenSummaries = useDashboardStore((s) => s.tokenSummaries);

  const totalInput = tokenSummaries.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = tokenSummaries.reduce((s, t) => s + t.outputTokens, 0);
  const totalCacheRead = tokenSummaries.reduce(
    (s, t) => s + t.cacheReadTokens,
    0
  );
  const totalCost = tokenSummaries.reduce(
    (s, t) => s + t.estimatedCostUsd,
    0
  );

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: 'var(--spacing-sm) var(--spacing-md)',
          borderBottom: '1px solid var(--border)',
          fontWeight: 600,
          fontSize: '13px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Token Usage</span>
        <span
          style={{
            color: totalCost > 1 ? '#f0ad4e' : 'var(--fg-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
          }}
        >
          {formatCost(totalCost)}
        </span>
      </div>

      <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }}>
        {/* Totals row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 'var(--spacing-sm)',
            marginBottom: 'var(--spacing-md)',
            textAlign: 'center',
          }}
        >
          <TokenStat label="Input" value={totalInput} />
          <TokenStat label="Output" value={totalOutput} />
          <TokenStat label="Cache Read" value={totalCacheRead} />
        </div>

        {/* Per-session breakdown */}
        {tokenSummaries.length > 0 && (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 'var(--spacing-sm)',
            }}
          >
            {tokenSummaries.map((ts) => (
              <div
                key={ts.sessionId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '2px 0',
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
                  title={ts.sessionSlug}
                >
                  {ts.sessionSlug}
                </span>
                <span style={{ color: 'var(--fg-muted)', fontSize: '10px' }}>
                  {ts.model.includes('opus')
                    ? 'Opus'
                    : ts.model.includes('sonnet')
                      ? 'Sonnet'
                      : ts.model.includes('haiku')
                        ? 'Haiku'
                        : ts.model}
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
        )}
      </div>
    </div>
  );
}

function TokenStat({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--fg-muted)',
          marginBottom: '2px',
        }}
      >
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
