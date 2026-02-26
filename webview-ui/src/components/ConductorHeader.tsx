import React from 'react';
import type { SessionInfo, TokenSummary } from '@shared/types';
import { formatCost } from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';
import { OwlblobMascot } from './OwlblobMascot';

interface ConductorHeaderProps {
  sessions: SessionInfo[];
  tokenSummaries: TokenSummary[];
  onRefresh: () => void;
  nudgeActive: boolean;
  onMascotClick: () => void;
  mascotButtonRef?: React.Ref<HTMLButtonElement>;
}

export function ConductorHeader({
  sessions,
  tokenSummaries,
  onRefresh,
  nudgeActive,
  onMascotClick,
  mascotButtonRef,
}: ConductorHeaderProps): React.ReactElement {
  const parentSessions = sessions.filter((s) => !s.isSubAgent);
  const workingCount = parentSessions.filter(
    (s) => s.status === 'working' || s.status === 'thinking'
  ).length;
  const waitingCount = parentSessions.filter((s) => s.status === 'waiting').length;
  const errorCount = parentSessions.filter((s) => s.status === 'error').length;
  const totalCost = tokenSummaries.reduce((sum, t) => sum + t.estimatedCostUsd, 0);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px var(--spacing-md)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
        <button
          ref={mascotButtonRef}
          onClick={onMascotClick}
          aria-label={UI_STRINGS.ZEN_MASCOT_LABEL}
          title={UI_STRINGS.ZEN_MASCOT_TOOLTIP}
          className={`zen-mascot-btn${nudgeActive ? ' zen-nudge-active' : ''}`}
        >
          <OwlblobMascot size={40} />
        </button>
        <h1
          style={{
            fontSize: '14px', // inline-ok
            fontWeight: 700,
            color: 'var(--fg-primary)',
            margin: 0,
          }}
        >
          {UI_STRINGS.CONDUCTOR_HEADING}
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 'var(--spacing-md)',
            fontSize: '12px', // inline-ok
            color: 'var(--fg-secondary)',
          }}
        >
          {workingCount > 0 && (
            <span>
              <span style={{ color: 'var(--status-working)', fontWeight: 600 }}>
                {workingCount}
              </span>{' '}
              working
            </span>
          )}
          {waitingCount > 0 && (
            <span>
              <span style={{ color: 'var(--status-waiting)', fontWeight: 600 }}>
                {waitingCount}
              </span>{' '}
              awaiting input
            </span>
          )}
          {errorCount > 0 && (
            <span>
              <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>
                {errorCount}
              </span>{' '}
              error
            </span>
          )}
          {totalCost > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: totalCost > 1 ? 'var(--status-waiting)' : 'var(--fg-muted)',
              }}
            >
              {formatCost(totalCost)} total
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onRefresh}
        style={{
          padding: '3px 10px', // inline-ok
          fontSize: '11px', // inline-ok
          borderRadius: '3px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--fg-secondary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        title="Refresh sessions" // inline-ok
      >
        {UI_STRINGS.REFRESH_BUTTON}
      </button>
    </div>
  );
}
