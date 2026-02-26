import React, { useState } from 'react';
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES, STATUS_GROUPS } from '@shared/sharedConstants';
import { StatusDot } from './StatusDot';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { getContextText } from '../utils/sessionContext';
import { timeAgo, formatCostCompact, getSessionDisplayName } from '../utils/formatters';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';

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
}: KanbanCardProps): React.ReactElement {
  const isActive = STATUS_GROUPS.ACTIVE.has(session.status);
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextText = getContextText(session);

  const contextMenuItems: ContextMenuItem[] = isHiddenTab
    ? [
        ...(onUnhide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_UNHIDE, action: () => onUnhide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => onRename(session.sessionId, getSessionDisplayName(session)),
        },
      ]
    : [
        ...(onHide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_HIDE, action: () => onHide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => onRename(session.sessionId, getSessionDisplayName(session)),
        },
      ];

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        padding: '8px 10px', // inline-ok
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
        display: 'flex',
        flexDirection: 'column',
        gap: '4px', // inline-ok
        minWidth: 0,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
      </div>

      {/* Row 2: Context text */}
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

      {/* Row 3: Cost + time ago */}
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
