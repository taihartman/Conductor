import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '@shared/types';
import { SESSION_STATUSES } from '@shared/sharedConstants';
import { STATUS_CONFIG } from '../config/statusConfig';
import { SIZES } from '../config/colors';
import { KanbanColumn } from './KanbanColumn';
import { UI_STRINGS } from '../config/strings';
import { useDashboardStore } from '../store/dashboardStore';
import { SORT_DIRECTIONS } from '@shared/sharedConstants';
import type { SortDirection } from '@shared/sharedConstants';
import { vscode } from '../vscode';

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

/** Priority ordering for vertical (narrow) layout — most urgent first. */
export const VERTICAL_COLUMN_ORDER = ['error', 'awaiting', 'performing', 'completed'] as const;

/** Returns columns in the correct order for the current layout mode. */
export function getOrderedColumns(isVertical: boolean): readonly ColumnDef[] {
  if (!isVertical) return COLUMNS;
  return VERTICAL_COLUMN_ORDER.map((key) => COLUMNS.find((c) => c.key === key)!);
}

/** In vertical mode, filters out columns with no sessions. */
export function getVisibleColumns(
  orderedColumns: readonly ColumnDef[],
  grouped: Map<string, SessionInfo[]>,
  isVertical: boolean,
): readonly ColumnDef[] {
  if (!isVertical) return orderedColumns;
  return orderedColumns.filter((col) => (grouped.get(col.key)?.length ?? 0) > 0);
}

/**
 * Sorts each column's sessions by `lastActivityAt`.
 * Direction is determined per-column via `sortOrders`; missing keys default to descending.
 * ISO 8601 strings sort lexicographically, so no Date parsing is needed.
 */
export function sortColumnSessions(
  grouped: Map<string, SessionInfo[]>,
  sortOrders: Record<string, SortDirection> = {},
): Map<string, SessionInfo[]> {
  const sorted = new Map<string, SessionInfo[]>();
  for (const [key, sessions] of grouped) {
    const direction = sortOrders[key] ?? SORT_DIRECTIONS.DESC;
    sorted.set(
      key,
      [...sessions].sort((a, b) => {
        const cmp =
          a.lastActivityAt > b.lastActivityAt ? 1 : a.lastActivityAt < b.lastActivityAt ? -1 : 0;
        return direction === SORT_DIRECTIONS.ASC ? cmp : -cmp;
      }),
    );
  }
  return sorted;
}

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
  onDragHandlePointerDown?: (e: React.PointerEvent, sessionId: string) => void;
  draggingSessionId?: string | null;
  boardRef?: React.RefObject<HTMLDivElement | null>;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
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
  onDragHandlePointerDown,
  draggingSessionId,
  boardRef,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: KanbanBoardProps): React.ReactElement {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = boardRef ?? internalRef;
  const [isVertical, setIsVertical] = useState(false);
  const kanbanSortOrders = useDashboardStore((s) => s.kanbanSortOrders);
  const toggleKanbanSortOrder = useDashboardStore((s) => s.toggleKanbanSortOrder);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const shouldBeVertical = width < SIZES.KANBAN_VERTICAL_BREAKPOINT;
      setIsVertical((prev) => (prev === shouldBeVertical ? prev : shouldBeVertical));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const grouped = useMemo(() => {
    const groups = groupSessionsByColumn(sessions);
    return sortColumnSessions(groups, kanbanSortOrders);
  }, [sessions, kanbanSortOrders]);

  const visibleColumns = useMemo(() => {
    const ordered = getOrderedColumns(isVertical);
    return getVisibleColumns(ordered, grouped, isVertical);
  }, [isVertical, grouped]);

  return (
    <div
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        gap: '4px', // inline-ok
        overflow: isVertical ? 'auto' : 'hidden',
        minHeight: 0,
        padding: '0 var(--spacing-sm) var(--spacing-sm)', // inline-ok
      }}
    >
      {visibleColumns.map((col) => (
        <div
          key={col.key}
          style={
            isVertical
              ? { maxHeight: SIZES.KANBAN_VERTICAL_ROW_MAX_HEIGHT, overflow: 'auto' }
              : { flex: 1, minWidth: 0, display: 'flex' }
          }
        >
          <KanbanColumn
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
            onDragHandlePointerDown={onDragHandlePointerDown}
            draggingSessionId={draggingSessionId}
            sortDirection={kanbanSortOrders[col.key] ?? SORT_DIRECTIONS.DESC}
            onToggleSort={() => {
              toggleKanbanSortOrder(col.key);
              const sortOrders = useDashboardStore.getState().kanbanSortOrders;
              vscode.postMessage({ type: 'kanban-sort-orders:set', sortOrders });
            }}
          />
        </div>
      ))}
    </div>
  );
}
