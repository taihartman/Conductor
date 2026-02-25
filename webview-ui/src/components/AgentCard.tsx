import React from 'react';
import type { SessionInfo } from '../store/dashboardStore';
import { StatusBadge } from './StatusBadge';

interface AgentCardProps {
  session: SessionInfo;
  isSelected: boolean;
  onClick: () => void;
}

function formatModel(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.split('-').pop() || model;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AgentCard({
  session,
  isSelected,
  onClick,
}: AgentCardProps): React.ReactElement {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 'var(--spacing-md)',
        backgroundColor: isSelected
          ? 'var(--accent)'
          : 'var(--bg-card)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
        transition: 'all 0.15s ease',
        opacity: isSelected ? 1 : undefined,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--accent)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--border)';
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--spacing-xs)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            fontSize: '13px',
            color: isSelected ? '#fff' : 'var(--fg-primary)',
          }}
        >
          {session.slug}
        </span>
        <StatusBadge status={session.status} />
      </div>

      {session.summary && (
        <p
          style={{
            fontSize: '12px',
            color: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--fg-secondary)',
            marginBottom: 'var(--spacing-sm)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.summary}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          gap: 'var(--spacing-md)',
          fontSize: '11px',
          color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--fg-muted)',
        }}
      >
        {session.model && (
          <span title={session.model}>{formatModel(session.model)}</span>
        )}
        {session.gitBranch && (
          <span title={session.gitBranch}>
            {session.gitBranch.length > 15
              ? session.gitBranch.substring(0, 15) + '...'
              : session.gitBranch}
          </span>
        )}
        <span>{session.turnCount} turns</span>
        <span title={`Input: ${formatTokens(session.totalInputTokens)}, Output: ${formatTokens(session.totalOutputTokens)}`}>
          {formatTokens(session.totalInputTokens + session.totalOutputTokens)} tokens
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {timeAgo(session.lastActivityAt)}
        </span>
      </div>
    </div>
  );
}
