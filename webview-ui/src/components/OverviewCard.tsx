import React, { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES, STATUS_GROUPS } from '@shared/sharedConstants';
import { StatusDot } from './StatusDot';
import { EnsembleIndicator } from './EnsembleIndicator';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
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
import { useLongPress } from '../hooks/useLongPress';

interface OverviewCardProps {
  session: SessionInfo;
  isSelected: boolean;
  cost: number;
  onClick: () => void;
  onDoubleClick: () => void;
  onRename: (sessionId: string, name: string) => void;
  onDragHandlePointerDown?: (e: React.PointerEvent) => void;
  isDragging?: boolean;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
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
      if (session.pendingQuestion?.isToolApproval) {
        const tools = session.pendingQuestion.pendingTools;
        if (tools && tools.length > 0) {
          const desc = tools
            .map((t) => (t.inputSummary ? `${t.toolName} — ${t.inputSummary}` : t.toolName))
            .join(', ');
          const maxLen = 80; // inline-ok: matches TRUNCATION.TOOL_APPROVAL_DESC_MAX
          const truncated = desc.length > maxLen ? desc.substring(0, maxLen) + '...' : desc;
          return `${UI_STRINGS.CONTEXT_TOOL_APPROVAL}: ${truncated}`;
        }
        return UI_STRINGS.CONTEXT_TOOL_APPROVAL;
      }
      if (session.pendingQuestion?.isPlanApproval) {
        return UI_STRINGS.CONTEXT_PLAN_APPROVAL;
      }
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
  onHide,
  onUnhide,
  isHiddenTab,
}: OverviewCardProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];
  const isActive = STATUS_GROUPS.ACTIVE.has(session.status);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const longPress = useLongPress({
    onLongPress: (pos) => setContextMenu(pos),
  });

  const contextMenuItems: ContextMenuItem[] = isHiddenTab
    ? [
        ...(onUnhide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_UNHIDE, action: () => onUnhide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => {
            setEditValue(getSessionDisplayName(session));
            setIsEditing(true);
          },
        },
      ]
    : [
        ...(onHide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_HIDE, action: () => onHide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => {
            setEditValue(getSessionDisplayName(session));
            setIsEditing(true);
          },
        },
      ];

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div
      onClick={() => {
        if (longPress.shouldSuppressClick()) return;
        onClick();
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
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
      {onDragHandlePointerDown && (
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
      )}

      {/* Card content */}
      <div
        onPointerDown={longPress.onPointerDown}
        onPointerUp={longPress.onPointerUp}
        onPointerCancel={longPress.onPointerCancel}
        onPointerMove={longPress.onPointerMove}
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
        {session.continuationCount != null && session.continuationCount > 0 && (
          <span
            style={{
              fontSize: '9px', // inline-ok
              fontWeight: 600,
              color: 'var(--fg-muted)',
              backgroundColor: COLORS.CONTINUATION_BADGE_BG,
              borderRadius: '3px',
              padding: '1px 5px', // inline-ok
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            title={`${session.continuationCount + 1} continuation segments`}
          >
            {UI_STRINGS.CONTINUATION_BADGE.replace(
              '{count}',
              String(session.continuationCount + 1)
            )}
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
        {isHovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setContextMenu({ x: rect.right, y: rect.bottom });
            }}
            aria-label={UI_STRINGS.CONTEXT_MENU_LABEL}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--fg-muted)',
              fontSize: '14px', // inline-ok
              padding: '0 2px', // inline-ok
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {'\u22EE'}
          </button>
        )}
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
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
