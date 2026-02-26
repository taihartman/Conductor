import React, { useMemo } from 'react';
import type { SessionInfo, SessionStatus } from '@shared/types';
import { SESSION_STATUSES } from '@shared/sharedConstants';
import { STATUS_CONFIG } from '../config/statusConfig';
import { KanbanColumn } from './KanbanColumn';
import { UI_STRINGS } from '../config/strings';

/** Column definition for the Kanban board. */
interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly statuses: ReadonlySet<SessionStatus>;
  readonly cssVar: string;
}

/** Kanban column definitions — order determines left-to-right rendering. */
const COLUMNS: readonly ColumnDef[] = [
  {
    key: 'performing',
    label: UI_STRINGS.KANBAN_COL_PERFORMING,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.WORKING, SESSION_STATUSES.THINKING]),
    cssVar: STATUS_CONFIG.working.cssVar,
  },
  {
    key: 'awaiting',
    label: UI_STRINGS.KANBAN_COL_AWAITING_INPUT,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.WAITING]),
    cssVar: STATUS_CONFIG.waiting.cssVar,
  },
  {
    key: 'error',
    label: UI_STRINGS.KANBAN_COL_NEEDS_ATTENTION,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.ERROR]),
    cssVar: STATUS_CONFIG.error.cssVar,
  },
  {
    key: 'completed',
    label: UI_STRINGS.KANBAN_COL_COMPLETED,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.DONE, SESSION_STATUSES.IDLE]),
    cssVar: STATUS_CONFIG.done.cssVar,
  },
];

/** Index of the fallback column for sessions with unrecognized status. */
const FALLBACK_COLUMN_INDEX = COLUMNS.length - 1; // inline-ok: completed column

interface KanbanBoardProps {
  sessions: SessionInfo[];
  costBySession: Map<string, number>;
  focusedSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onSessionDoubleClick: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
}

/**
 * Groups sessions into Kanban columns by status.
 * Sessions with unrecognized status fall into the last column (Completed).
 */
export function groupSessionsByColumn(sessions: readonly SessionInfo[]): Map<string, SessionInfo[]> {
  const result = new Map<string, SessionInfo[]>();
  for (const col of COLUMNS) {
    result.set(col.key, []);
  }
  for (const session of sessions) {
    let placed = false;
    for (const col of COLUMNS) {
      if (col.statuses.has(session.status)) {
        result.get(col.key)!.push(session);
        placed = true;
        break;
      }
    }
    if (!placed) {
      result.get(COLUMNS[FALLBACK_COLUMN_INDEX].key)!.push(session);
    }
  }
  return result;
}

export function KanbanBoard({
  sessions,
  costBySession,
  focusedSessionId,
  onSessionClick,
  onSessionDoubleClick,
  onRename,
  onHide,
  onUnhide,
  isHiddenTab,
}: KanbanBoardProps): React.ReactElement {
  const grouped = useMemo(() => groupSessionsByColumn(sessions), [sessions]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        gap: '4px', // inline-ok
        overflow: 'hidden',
        minHeight: 0,
        padding: '0 var(--spacing-sm) var(--spacing-sm)', // inline-ok
      }}
    >
      {COLUMNS.map((col) => (
        <KanbanColumn
          key={col.key}
          label={col.label}
          sessions={grouped.get(col.key) || []}
          borderColor={`var(${col.cssVar})`}
          focusedSessionId={focusedSessionId}
          costBySession={costBySession}
          onSessionClick={onSessionClick}
          onSessionDoubleClick={onSessionDoubleClick}
          onRename={onRename}
          onHide={onHide}
          onUnhide={onUnhide}
          isHiddenTab={isHiddenTab}
        />
      ))}
    </div>
  );
}
