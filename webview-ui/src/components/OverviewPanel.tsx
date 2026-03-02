import React, { useMemo } from 'react';
import type { SessionInfo, TokenSummary } from '@shared/types';
import { OverviewCard } from './OverviewCard';
import { KanbanBoard } from './KanbanBoard';
import { useDragReorder } from '../hooks/useDragReorder';
import type { DragReorderOptions } from '../hooks/useDragReorder';
import { findDropTarget, edgeToDirection } from '../hooks/useDragToTile';
import { useDashboardStore } from '../store/dashboardStore';
import { OVERVIEW_MODES } from '@shared/sharedConstants';
import type { OverviewMode } from '@shared/sharedConstants';
import { UI_STRINGS } from '../config/strings';
import { vscode } from '../vscode';

interface OverviewPanelProps {
  sessions: SessionInfo[];
  tokenSummaries: TokenSummary[];
  focusedSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onSessionDoubleClick: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onReorder: (sessionIds: string[]) => void;
  searchQuery: string;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
}

export function OverviewPanel({
  sessions,
  tokenSummaries,
  focusedSessionId,
  onSessionClick,
  onSessionDoubleClick,
  onRename,
  onReorder,
  searchQuery,
  onHide,
  onUnhide,
  isHiddenTab,
}: OverviewPanelProps): React.ReactElement {
  const overviewMode = useDashboardStore((s) => s.overviewMode);
  const setOverviewMode = useDashboardStore((s) => s.setOverviewMode);
  const tileRoot = useDashboardStore((s) => s.tileRoot);
  const enterTilingMode = useDashboardStore((s) => s.enterTilingMode);
  const splitTile = useDashboardStore((s) => s.splitTile);
  const setTileSession = useDashboardStore((s) => s.setTileSession);
  const setDragToTileTarget = useDashboardStore((s) => s.setDragToTileTarget);

  // Build cost lookup
  const costBySession = new Map<string, number>();
  for (const ts of tokenSummaries) {
    costBySession.set(ts.sessionId, (costBySession.get(ts.sessionId) || 0) + ts.estimatedCostUsd);
  }

  // sessions already pre-filtered by ConductorDashboard (no sub-agents, no hidden artifacts)
  const topLevelIds = sessions.map((s) => s.sessionId);

  const dragToTileOptions = useMemo<DragReorderOptions>(
    () => ({
      onDragMove: (clientX, clientY) => {
        if (tileRoot) {
          const target = findDropTarget(clientX, clientY);
          setDragToTileTarget(target);
        }
      },
      onDropOutside: (sessionId, clientX, clientY) => {
        if (!tileRoot) {
          // First tile — enter tiling mode
          enterTilingMode(sessionId);
          vscode.postMessage({ type: 'tile:subscribe', sessionId });
        } else {
          const target = findDropTarget(clientX, clientY);
          if (target) {
            const direction = edgeToDirection(target.edge);
            if (direction) {
              const insertBefore = target.edge === 'left' || target.edge === 'top';
              splitTile(target.tileId, direction, sessionId, insertBefore);
            } else {
              // center — replace tile session
              setTileSession(target.tileId, sessionId);
            }
            vscode.postMessage({ type: 'tile:subscribe', sessionId });
          }
        }
      },
      onDragEnd: () => {
        setDragToTileTarget(null);
      },
    }),
    [tileRoot, enterTilingMode, splitTile, setTileSession, setDragToTileTarget]
  );

  const {
    gridRef,
    draggingSessionId,
    indicatorStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useDragReorder(topLevelIds, onReorder, dragToTileOptions);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Sticky toggle bar — outside scroll area */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '4px var(--spacing-sm) 0', // inline-ok
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => {
            const newMode: OverviewMode =
              overviewMode === OVERVIEW_MODES.LIST ? OVERVIEW_MODES.BOARD : OVERVIEW_MODES.LIST;
            setOverviewMode(newMode);
            vscode.postMessage({ type: 'overview-mode:set', mode: newMode });
          }}
          title={
            overviewMode === OVERVIEW_MODES.LIST
              ? UI_STRINGS.KANBAN_TOGGLE_BOARD
              : UI_STRINGS.KANBAN_TOGGLE_LIST
          }
          aria-label={
            overviewMode === OVERVIEW_MODES.LIST
              ? UI_STRINGS.KANBAN_TOGGLE_BOARD
              : UI_STRINGS.KANBAN_TOGGLE_LIST
          }
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--fg-muted)',
            fontSize: '14px', // inline-ok
            padding: '2px 6px', // inline-ok
            borderRadius: '3px', // inline-ok
          }}
        >
          {overviewMode === OVERVIEW_MODES.LIST ? '\u2637' : '\u2630'}
        </button>
      </div>

      {/* Content area */}
      {sessions.length === 0 ? (
        <div
          style={{
            flex: 1,
            padding: 'var(--spacing-xl)',
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: '12px', // inline-ok
          }}
        >
          {searchQuery
            ? UI_STRINGS.SEARCH_NO_RESULTS
            : isHiddenTab
              ? UI_STRINGS.HIDDEN_TAB_EMPTY
              : UI_STRINGS.NO_SESSIONS_MATCH}
        </div>
      ) : overviewMode === OVERVIEW_MODES.BOARD ? (
        <KanbanBoard
          sessions={sessions}
          costBySession={costBySession}
          focusedSessionId={focusedSessionId}
          onSessionClick={onSessionClick}
          onSessionDoubleClick={onSessionDoubleClick}
          onRename={onRename}
          onHide={onHide}
          onUnhide={onUnhide}
          isHiddenTab={isHiddenTab}
          boardRef={gridRef}
          onDragHandlePointerDown={
            isHiddenTab ? undefined : handlePointerDown
          }
          draggingSessionId={draggingSessionId}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
            padding: 'var(--spacing-sm)',
          }}
        >
          <div
            ref={gridRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', // inline-ok
              gap: 'var(--spacing-sm)',
              position: 'relative',
            }}
          >
            {sessions.map((session) => (
              <div key={session.sessionId} data-session-id={session.sessionId}>
                <OverviewCard
                  session={session}
                  isSelected={focusedSessionId === session.sessionId}
                  cost={costBySession.get(session.sessionId) || 0}
                  onClick={() => onSessionClick(session.sessionId)}
                  onDoubleClick={() => onSessionDoubleClick(session.sessionId)}
                  onRename={onRename}
                  onDragHandlePointerDown={
                    isHiddenTab ? undefined : (e) => handlePointerDown(e, session.sessionId)
                  }
                  isDragging={draggingSessionId === session.sessionId}
                  onHide={onHide}
                  onUnhide={onUnhide}
                  isHiddenTab={isHiddenTab}
                />
              </div>
            ))}
            {/* Absolutely-positioned drop indicator — does not disrupt grid flow */}
            {indicatorStyle && <div style={indicatorStyle} />}
          </div>
        </div>
      )}
    </div>
  );
}
