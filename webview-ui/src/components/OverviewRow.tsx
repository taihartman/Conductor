import React from 'react';
import type { SessionInfo } from '@shared/types';
import { StatusDot } from './StatusDot';
import { EnsembleIndicator } from './EnsembleIndicator';
import { STATUS_CONFIG } from '../config/statusConfig';

interface OverviewRowProps {
  session: SessionInfo;
  isSelected: boolean;
  cost: number;
  onClick: () => void;
  onDoubleClick: () => void;
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatCost(usd: number): string {
  if (usd === 0) return '';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function getContextText(session: SessionInfo): string {
  switch (session.status) {
    case 'working':
      if (session.lastToolName) {
        return session.lastToolInput
          ? `[${session.lastToolName}] ${session.lastToolInput}`
          : `[${session.lastToolName}]`;
      }
      return 'Working...';
    case 'thinking':
      return 'Thinking...';
    case 'waiting':
      return session.pendingQuestion
        ? session.pendingQuestion.length > 60
          ? session.pendingQuestion.substring(0, 60) + '...'
          : session.pendingQuestion
        : 'Ready for input';
    case 'error':
      return 'Stuck \u2014 errors';
    case 'idle':
    case 'done':
      return `${timeAgo(session.lastActivityAt)} ago`;
    default:
      return '';
  }
}

export function OverviewRow({
  session,
  isSelected,
  cost,
  onClick,
  onDoubleClick,
}: OverviewRowProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: '6px var(--spacing-md)',
        cursor: 'pointer',
        backgroundColor: isSelected ? 'rgba(0, 122, 204, 0.12)' : undefined,
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
        borderBottom: '1px solid var(--border)',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = '';
        }
      }}
    >
      {/* Status dot */}
      <StatusDot status={session.status} size={8} />

      {/* Slug */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--fg-primary)',
          minWidth: '72px',
          maxWidth: '72px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={session.slug}
      >
        {session.slug}
      </span>

      {/* Status label */}
      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: `var(${config.cssVar})`,
          minWidth: '62px',
        }}
      >
        {config.label}
      </span>

      {/* Context text */}
      <span
        style={{
          flex: 1,
          fontSize: '11px',
          color: 'var(--fg-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: session.status === 'working' ? 'var(--font-mono)' : undefined,
        }}
        title={getContextText(session)}
      >
        {getContextText(session)}
      </span>

      {/* Ensemble indicator */}
      {session.childAgents && session.childAgents.length > 0 && (
        <EnsembleIndicator childAgents={session.childAgents} />
      )}

      {/* Cost */}
      {cost > 0 && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-mono)',
            minWidth: '45px',
            textAlign: 'right',
          }}
        >
          {formatCost(cost)}
        </span>
      )}

      {/* Time */}
      <span
        style={{
          fontSize: '10px',
          color: 'var(--fg-muted)',
          minWidth: '24px',
          textAlign: 'right',
        }}
      >
        {timeAgo(session.lastActivityAt)}
      </span>
    </div>
  );
}
