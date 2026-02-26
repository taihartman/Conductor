import React, { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES, STATUS_GROUPS } from '@shared/sharedConstants';
import { StatusDot } from './StatusDot';
import { EnsembleIndicator } from './EnsembleIndicator';
import { STATUS_CONFIG } from '../config/statusConfig';
import {
  timeAgo,
  formatCostCompact,
  formatTokens,
  formatModel,
  getSessionDisplayName,
} from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';

interface OverviewCardProps {
  session: SessionInfo;
  isSelected: boolean;
  cost: number;
  onClick: () => void;
  onDoubleClick: () => void;
  onRename: (sessionId: string, name: string) => void;
  onDragHandlePointerDown: (e: React.PointerEvent) => void;
  isDragging?: boolean;
}

function getContextText(session: SessionInfo): string {
  switch (session.status) {
    case SESSION_STATUSES.WORKING:
      if (session.lastToolName) {
        return session.lastToolInput
          ? `${session.lastToolName} — ${session.lastToolInput}`
          : session.lastToolName;
      }
      return UI_STRINGS.CONTEXT_WORKING;
    case SESSION_STATUSES.THINKING:
      return UI_STRINGS.CONTEXT_THINKING;
    case SESSION_STATUSES.WAITING:
      return session.pendingQuestion
        ? session.pendingQuestion.question.length > 80
          ? session.pendingQuestion.question.substring(0, 80) + '...'
          : session.pendingQuestion.question
        : UI_STRINGS.CONTEXT_WAITING;
    case SESSION_STATUSES.ERROR:
      return UI_STRINGS.CONTEXT_ERROR;
    case SESSION_STATUSES.DONE:
      if (session.lastAssistantText) {
        return session.lastAssistantText;
      }
      return `${UI_STRINGS.CONTEXT_DONE} \u2014 ${timeAgo(session.lastActivityAt)}`;
    case SESSION_STATUSES.IDLE:
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
  onDragHandlePointerDown,
  isDragging,
}: OverviewCardProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];
  const isActive = STATUS_GROUPS.ACTIVE.has(session.status);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isHovered, setIsHovered] = useState(false);
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
        padding: '0', // inline-ok
        cursor: 'pointer',
        backgroundColor: isSelected
          ? COLORS.SELECTED_CARD_BG
          : 'var(--bg-card)',
        border: isSelected
          ? '1px solid var(--accent)'
          : '1px solid var(--border)',
        borderRadius: '6px',
        transition: 'background-color 0.1s, border-color 0.1s, opacity 0.15s',
        display: 'flex',
        flexDirection: 'row',
        minWidth: 0,
        opacity: isDragging ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        setIsHovered(true);
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = COLORS.HOVER_CARD_BG;
          e.currentTarget.style.borderColor = 'var(--fg-muted)';
        }
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'var(--bg-card)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }
      }}
    >
      {/* Drag handle */}
      <div
        onPointerDown={onDragHandlePointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title={UI_STRINGS.DRAG_HANDLE_TOOLTIP}
        aria-label={UI_STRINGS.DRAG_HANDLE_LABEL}
        style={{
          width: '16px', // inline-ok
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          color: isHovered ? COLORS.DRAG_HANDLE_HOVER : 'transparent',
          fontSize: '10px', // inline-ok
          letterSpacing: '-1px',
          userSelect: 'none',
          borderRadius: '6px 0 0 6px',
          transition: 'color 0.15s',
        }}
      >
        {'\u22EE\u22EE'}
      </div>

      {/* Card content */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: '10px 12px 10px 0', // inline-ok
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
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
              fontSize: '13px', // inline-ok
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
              fontSize: '13px', // inline-ok
              fontWeight: 700,
              color: 'var(--fg-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'text',
            }}
            title={session.customName || session.autoName ? session.slug : UI_STRINGS.RENAME_HINT}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditValue(getSessionDisplayName(session));
              setIsEditing(true);
            }}
          >
            {getSessionDisplayName(session)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: '10px', // inline-ok
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
          fontSize: '11px', // inline-ok
          color: isActive ? 'var(--fg-primary)' : 'var(--fg-secondary)',
          fontFamily: session.status === SESSION_STATUSES.WORKING ? 'var(--font-mono)' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minHeight: '16px', // inline-ok
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
          fontSize: '10px', // inline-ok
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
    </div>
  );
}
