import React, { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '@shared/types';
import { StatusDot } from './StatusDot';
import { EnsembleIndicator } from './EnsembleIndicator';
import { STATUS_CONFIG } from '../config/statusConfig';
import { timeAgo, formatCostCompact, formatTokens, formatModel } from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';

interface OverviewCardProps {
  session: SessionInfo;
  isSelected: boolean;
  cost: number;
  onClick: () => void;
  onDoubleClick: () => void;
  onRename: (sessionId: string, name: string) => void;
}

function getContextText(session: SessionInfo): string {
  switch (session.status) {
    case 'working':
      if (session.lastToolName) {
        return session.lastToolInput
          ? `${session.lastToolName} — ${session.lastToolInput}`
          : session.lastToolName;
      }
      return UI_STRINGS.CONTEXT_WORKING;
    case 'thinking':
      return UI_STRINGS.CONTEXT_THINKING;
    case 'waiting':
      return session.pendingQuestion
        ? session.pendingQuestion.length > 80
          ? session.pendingQuestion.substring(0, 80) + '...'
          : session.pendingQuestion
        : UI_STRINGS.CONTEXT_WAITING;
    case 'error':
      return UI_STRINGS.CONTEXT_ERROR;
    case 'idle':
    case 'done':
      return timeAgo(session.lastActivityAt);
    default:
      return '';
  }
}

export function OverviewCard({
  session,
  isSelected,
  cost,
  onClick,
  onDoubleClick,
  onRename,
}: OverviewCardProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];
  const isActive = session.status === 'working' || session.status === 'thinking';
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        backgroundColor: isSelected
          ? COLORS.SELECTED_CARD_BG
          : 'var(--bg-card)',
        border: isSelected
          ? '1px solid var(--accent)'
          : '1px solid var(--border)',
        borderRadius: '6px',
        transition: 'background-color 0.1s, border-color 0.1s',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = COLORS.HOVER_CARD_BG;
          e.currentTarget.style.borderColor = 'var(--fg-muted)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'var(--bg-card)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }
      }}
    >
      {/* Row 1: Status dot + slug + status label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <StatusDot status={session.status} size={8} />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                setIsEditing(false);
                onRename(session.sessionId, editValue);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setIsEditing(false);
              }
            }}
            onBlur={() => setIsEditing(false)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--fg-primary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--accent)',
              borderRadius: '3px',
              padding: '0 4px',
              outline: 'none',
              minWidth: 0,
              flex: 1,
            }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--fg-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'text',
            }}
            title={session.customName ? session.slug : UI_STRINGS.RENAME_HINT}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditValue(session.customName ?? session.slug);
              setIsEditing(true);
            }}
          >
            {session.customName ?? session.slug}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: `var(${config.cssVar})`,
            whiteSpace: 'nowrap',
          }}
        >
          {config.label}
        </span>
      </div>

      {/* Row 2: Context text (what Claude is doing) */}
      <div
        style={{
          fontSize: '11px',
          color: isActive ? 'var(--fg-primary)' : 'var(--fg-secondary)',
          fontFamily: session.status === 'working' ? 'var(--font-mono)' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minHeight: '16px',
        }}
        title={getContextText(session)}
      >
        {getContextText(session)}
      </div>

      {/* Row 3: Meta (model, tokens, cost, ensemble, time) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '10px',
          color: 'var(--fg-muted)',
        }}
      >
        {session.model && (
          <span title={session.model}>
            {formatModel(session.model)}
          </span>
        )}

        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {formatTokens(session.totalInputTokens + session.totalOutputTokens)}
        </span>

        {cost > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)' }}>{formatCostCompact(cost)}</span>
        )}

        {session.childAgents && session.childAgents.length > 0 && (
          <EnsembleIndicator childAgents={session.childAgents} />
        )}

        <span style={{ flex: 1 }} />

        <span>{timeAgo(session.lastActivityAt)}</span>
      </div>
    </div>
  );
}
