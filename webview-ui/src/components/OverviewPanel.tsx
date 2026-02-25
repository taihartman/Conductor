import React from 'react';
import type { SessionInfo, TokenSummary } from '@shared/types';
import { OverviewRow } from './OverviewRow';

interface OverviewPanelProps {
  sessions: SessionInfo[];
  tokenSummaries: TokenSummary[];
  focusedSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onSessionDoubleClick: (sessionId: string) => void;
}

export function OverviewPanel({
  sessions,
  tokenSummaries,
  focusedSessionId,
  onSessionClick,
  onSessionDoubleClick,
}: OverviewPanelProps): React.ReactElement {
  // Build cost lookup
  const costBySession = new Map<string, number>();
  for (const ts of tokenSummaries) {
    costBySession.set(ts.sessionId, (costBySession.get(ts.sessionId) || 0) + ts.estimatedCostUsd);
  }

  // Only show parent sessions + orphaned sub-agents
  const topLevelSessions = sessions.filter((s) => !s.isSubAgent || !s.parentSessionId);

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: 0,
      }}
    >
      {topLevelSessions.length === 0 ? (
        <div
          style={{
            padding: 'var(--spacing-xl)',
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: '12px',
          }}
        >
          No sessions match the current filter
        </div>
      ) : (
        topLevelSessions.map((session) => (
          <OverviewRow
            key={session.sessionId}
            session={session}
            isSelected={focusedSessionId === session.sessionId}
            cost={costBySession.get(session.sessionId) || 0}
            onClick={() => onSessionClick(session.sessionId)}
            onDoubleClick={() => onSessionDoubleClick(session.sessionId)}
          />
        ))
      )}
    </div>
  );
}
