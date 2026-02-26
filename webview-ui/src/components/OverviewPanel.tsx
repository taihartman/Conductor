import React from 'react';
import type { SessionInfo, TokenSummary } from '@shared/types';
import { OverviewCard } from './OverviewCard';
import { KanbanBoard } from './KanbanBoard';
import { useDragReorder } from '../hooks/useDragReorder';
import { useDashboardStore, OVERVIEW_MODES } from '../store/dashboardStore';
import { UI_STRINGS } from '../config/strings';

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

  // Build cost lookup
  const costBySession = new Map<string, number>();
  for (const ts of tokenSummaries) {
    costBySession.set(ts.sessionId, (costBySession.get(ts.sessionId) || 0) + ts.estimatedCostUsd);
  }

  // sessions already pre-filtered by ConductorDashboard (no sub-agents, no hidden artifacts)
  const topLevelIds = sessions.map((s) => s.sessionId);

  const {
    gridRef,
    draggingSessionId,
    indicatorStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useDragReorder(topLevelIds, onReorder);

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
          onClick={() =>
            setOverviewMode(
              overviewMode === OVERVIEW_MODES.LIST ? OVERVIEW_MODES.BOARD : OVERVIEW_MODES.LIST
            )
          }
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
