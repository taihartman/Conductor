import React from 'react';
import type { SessionInfo } from '@shared/types';
import { KanbanCard } from './KanbanCard';
import { UI_STRINGS } from '../config/strings';
import type { SortDirection } from '@shared/sharedConstants';
import { SORT_DIRECTIONS } from '@shared/sharedConstants';

interface KanbanColumnProps {
  label: string;
  sessions: SessionInfo[];
  borderColor: string;
  focusedSessionId: string | null;
  costBySession: Map<string, number>;
  onSessionClick: (sessionId: string) => void;
  onSessionDoubleClick: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
  sortDirection: SortDirection;
  onToggleSort: () => void;
  onDragHandlePointerDown?: (e: React.PointerEvent, sessionId: string) => void;
  draggingSessionId?: string | null;
}

export function KanbanColumn({
  label,
  sessions,
  borderColor,
  focusedSessionId,
  costBySession,
  onSessionClick,
  onSessionDoubleClick,
  onRename,
  onHide,
  onUnhide,
  isHiddenTab,
  sortDirection,
  onToggleSort,
  onDragHandlePointerDown,
  draggingSessionId,
}: KanbanColumnProps): React.ReactElement {
  const isDesc = sortDirection === SORT_DIRECTIONS.DESC;
  const sortTooltip = isDesc ? UI_STRINGS.KANBAN_SORT_NEWEST : UI_STRINGS.KANBAN_SORT_OLDEST;
  return (
    <div
      style={{
        flex: 1,
        minWidth: '120px', // inline-ok: minimum column width before horizontal scroll
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Column header */}
      <div
        style={{
          padding: '6px 8px', // inline-ok
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          borderBottom: `2px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '11px', // inline-ok
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px', // inline-ok
            color: borderColor,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: '10px', // inline-ok
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ({sessions.length})
        </span>
        <button
          onClick={onToggleSort}
          title={sortTooltip}
          aria-label={sortTooltip}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--fg-muted)',
            fontSize: '11px', // inline-ok
            padding: '0 2px', // inline-ok
            lineHeight: 1, // inline-ok
            marginLeft: 'auto', // inline-ok: push to right edge
          }}
        >
          {isDesc ? '\u2193' : '\u2191'}
        </button>
      </div>

      {/* Card list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '6px 4px', // inline-ok
          display: 'flex',
          flexDirection: 'column',
          gap: '4px', // inline-ok
          minHeight: 0,
        }}
      >
        {sessions.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-lg)',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: '10px', // inline-ok
              opacity: 0.6, // inline-ok
            }}
          >
            {UI_STRINGS.KANBAN_EMPTY_COLUMN}
          </div>
        ) : (
          sessions.map((session) => (
            <KanbanCard
              key={session.sessionId}
              session={session}
              isSelected={focusedSessionId === session.sessionId}
              cost={costBySession.get(session.sessionId) || 0}
              borderColor={borderColor}
              onClick={() => onSessionClick(session.sessionId)}
              onDoubleClick={() => onSessionDoubleClick(session.sessionId)}
              onRename={onRename}
              onHide={onHide}
              onUnhide={onUnhide}
              isHiddenTab={isHiddenTab}
              onDragHandlePointerDown={
                onDragHandlePointerDown
                  ? (e: React.PointerEvent) => onDragHandlePointerDown(e, session.sessionId)
                  : undefined
              }
              isDragging={draggingSessionId === session.sessionId}
            />
          ))
        )}
      </div>
    </div>
  );
}
