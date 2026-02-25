import React from 'react';
import type { SessionInfo } from '@shared/types';
import { StatusDot } from './StatusDot';
import { STATUS_CONFIG } from '../config/statusConfig';
import { formatModel, formatTokens, formatCostCompact } from '../utils/formatters';

interface SessionStatsBarProps {
  session: SessionInfo;
  cost: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function SessionStatsBar({
  session,
  cost,
  isExpanded,
  onToggleExpand,
}: SessionStatsBarProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-md)',
        padding: '6px var(--spacing-md)',
        height: '40px',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        fontSize: '12px',
      }}
    >
      <StatusDot status={session.status} size={8} />

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: 'var(--fg-primary)',
        }}
        title={session.slug}
      >
        {session.customName ?? session.slug}
      </span>

      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: `var(${config.cssVar})`,
        }}
      >
        {config.label}
      </span>

      {session.model && (
        <span style={{ color: 'var(--fg-secondary)' }} title={session.model}>
          {formatModel(session.model)}
        </span>
      )}

      {session.gitBranch && (
        <span
          style={{
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            maxWidth: '120px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={session.gitBranch}
        >
          {session.gitBranch}
        </span>
      )}

      <span style={{ color: 'var(--fg-muted)' }}>{session.turnCount} turns</span>

      <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
        {formatTokens(session.totalInputTokens + session.totalOutputTokens)} tokens
      </span>

      {cost > 0 && (
        <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          {formatCostCompact(cost)}
        </span>
      )}

      <span style={{ flex: 1 }} />

      <button
        onClick={onToggleExpand}
        style={{
          padding: '2px 6px',
          fontSize: '14px',
          borderRadius: '3px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--fg-secondary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          lineHeight: 1,
        }}
        title={isExpanded ? 'Collapse (Esc)' : 'Expand'}
      >
        {isExpanded ? '\u2199' : '\u2197'}
      </button>
    </div>
  );
}
