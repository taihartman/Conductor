import React, { useState, useCallback } from 'react';
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES, STATUS_GROUPS } from '@shared/sharedConstants';
import { StatusDot } from './StatusDot';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { getContextText } from '../utils/sessionContext';
import { vscode } from '../vscode';
import { timeAgo, formatCostCompact, getSessionDisplayName, formatUserMessage } from '../utils/formatters';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';
import { useDashboardStore } from '../store/dashboardStore';
import { useInlineEdit } from '../hooks/useInlineEdit';

interface KanbanCardProps {
  session: SessionInfo;
  isSelected: boolean;
  cost: number;
  borderColor: string;
  onClick: () => void;
  onDoubleClick: () => void;
  onRename: (sessionId: string, name: string) => void;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
  onDragHandlePointerDown?: (e: React.PointerEvent) => void;
  isDragging?: boolean;
}

export function KanbanCard({
  session,
  isSelected,
  cost,
  borderColor,
  onClick,
  onDoubleClick,
  onRename,
  onHide,
  onUnhide,
  isHiddenTab,
  onDragHandlePointerDown,
  isDragging,
}: KanbanCardProps): React.ReactElement {
  const isActive = STATUS_GROUPS.ACTIVE.has(session.status);
  const isKeyboardFocused = useDashboardStore(
    (s) => s.keyboardFocusedSessionId === session.sessionId
  );
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextText = getContextText(session);

  const handleSave = useCallback(
    (value: string) => onRename(session.sessionId, value),
    [onRename, session.sessionId]
  );
  const { isEditing, editValue, inputRef, startEditing, setEditValue, handleKeyDown, handleBlur } =
    useInlineEdit({ onSave: handleSave });

  const showTerminalItem: ContextMenuItem[] = session.launchedByConductor
    ? [{
        label: UI_STRINGS.CONTEXT_MENU_SHOW_VS_TERMINAL,
        action: () => vscode.postMessage({ type: 'session:show-terminal', sessionId: session.sessionId }),
      }]
    : [];

  const contextMenuItems: ContextMenuItem[] = isHiddenTab
    ? [
        ...(onUnhide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_UNHIDE, action: () => onUnhide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => startEditing(getSessionDisplayName(session)),
        },
        ...showTerminalItem,
        {
          label: UI_STRINGS.CONTEXT_MENU_COPY_SESSION_ID,
          action: () => navigator.clipboard.writeText(session.sessionId),
        },
        {
          label: UI_STRINGS.CONTEXT_MENU_COPY_RESUME_CMD,
          action: () => navigator.clipboard.writeText(`claude --resume ${session.sessionId}`),
        },
      ]
    : [
        ...(onHide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_HIDE, action: () => onHide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => startEditing(getSessionDisplayName(session)),
        },
        ...showTerminalItem,
        {
          label: UI_STRINGS.CONTEXT_MENU_COPY_SESSION_ID,
          action: () => navigator.clipboard.writeText(session.sessionId),
        },
        {
          label: UI_STRINGS.CONTEXT_MENU_COPY_RESUME_CMD,
          action: () => navigator.clipboard.writeText(`claude --resume ${session.sessionId}`),
        },
      ];

  return (
    <div
      data-session-id={session.sessionId}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        cursor: 'pointer',
        backgroundColor: isSelected
          ? COLORS.SELECTED_CARD_BG
          : isHovered
            ? COLORS.HOVER_CARD_BG
            : 'var(--bg-card)',
        borderLeft: `2px solid ${borderColor}`,
        borderTop: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRight: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderBottom: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: '4px', // inline-ok
        transition: 'background-color 0.1s, border-color 0.1s',
        boxShadow: isKeyboardFocused ? `0 0 0 2px ${COLORS.KEYBOARD_FOCUS_RING}` : undefined,
        display: 'flex',
        flexDirection: 'row',
        minWidth: 0,
        opacity: isDragging ? 0.4 : 1, // inline-ok: dim while dragging
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
            borderRadius: '4px 0 0 4px', // inline-ok
            transition: 'color 0.15s',
          }}
        >
          {'\u22EE\u22EE'}
        </div>
      )}

      {/* Card content */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: '8px 10px', // inline-ok
          display: 'flex',
          flexDirection: 'column',
          gap: '4px', // inline-ok
        }}
      >
        {/* Row 1: StatusDot + session name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          minWidth: 0,
        }}
      >
        <StatusDot status={session.status} size={6} />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px', // inline-ok
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
              fontSize: '12px', // inline-ok
              fontWeight: 700,
              color: 'var(--fg-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={getSessionDisplayName(session)}
          >
            {getSessionDisplayName(session)}
          </span>
        )}
      </div>

      {/* Row 2: User message ("You: ...") */}
      {session.lastUserText && (
        <div
          style={{
            fontSize: '10px', // inline-ok
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={session.lastUserText}
        >
          <span style={{ color: 'var(--fg-muted)' }}>{UI_STRINGS.USER_MESSAGE_PREFIX} </span>
          <span style={{ color: 'var(--fg-secondary)' }}>
            {formatUserMessage(session.lastUserText)}
          </span>
        </div>
      )}

      {/* Row 3: Context text */}
      <div
        style={{
          fontSize: '10px', // inline-ok
          color: isActive ? 'var(--fg-primary)' : 'var(--fg-secondary)',
          fontFamily: session.status === SESSION_STATUSES.WORKING ? 'var(--font-mono)' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={contextText}
      >
        {contextText}
      </div>

      {/* Row 4: Cost + time ago */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          fontSize: '9px', // inline-ok
          color: 'var(--fg-muted)',
        }}
      >
        {cost > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)' }}>{formatCostCompact(cost)}</span>
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
