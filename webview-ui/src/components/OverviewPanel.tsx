import React from 'react';
import type { SessionInfo, TokenSummary } from '@shared/types';
import { OverviewCard } from './OverviewCard';
import { useDragReorder } from '../hooks/useDragReorder';
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
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: 0,
        padding: 'var(--spacing-sm)',
      }}
    >
      {sessions.length === 0 ? (
        <div
          style={{
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
      ) : (
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
      )}
    </div>
  );
}
