import React, { useCallback, useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { ConductorHeader } from './ConductorHeader';
import { OverviewPanel } from './OverviewPanel';
import { DetailPanel } from './DetailPanel';
import { CollapsedBar } from './CollapsedBar';
import { EmptyState } from './EmptyState';
import { vscode } from '../vscode';

const RECENT_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export function ConductorDashboard(): React.ReactElement {
  const sessions = useDashboardStore((s) => s.sessions);
  const tokenSummaries = useDashboardStore((s) => s.tokenSummaries);
  const focusedSessionId = useDashboardStore((s) => s.focusedSessionId);
  const filterMode = useDashboardStore((s) => s.filterMode);
  const detailViewMode = useDashboardStore((s) => s.detailViewMode);
  const setFocusedSession = useDashboardStore((s) => s.setFocusedSession);
  const expandFocusedSession = useDashboardStore((s) => s.expandFocusedSession);
  const collapseFocusedSession = useDashboardStore((s) => s.collapseFocusedSession);
  const clearFocus = useDashboardStore((s) => s.clearFocus);

  // Filter sessions
  const filteredSessions = (() => {
    switch (filterMode) {
      case 'active':
        return sessions.filter(
          (s) => s.status === 'working' || s.status === 'thinking' || s.status === 'waiting'
        );
      case 'recent': {
        const cutoff = Date.now() - RECENT_THRESHOLD_MS;
        return sessions.filter((s) => new Date(s.lastActivityAt).getTime() > cutoff);
      }
      default:
        return sessions;
    }
  })();

  // Find focused session
  const focusedSession = focusedSessionId
    ? sessions.find((s) => s.sessionId === focusedSessionId)
    : undefined;

  // Handlers
  function handleSessionClick(sessionId: string): void {
    if (focusedSessionId === sessionId) {
      clearFocus();
    } else {
      setFocusedSession(sessionId);
      vscode.postMessage({ type: 'session:focus', sessionId });
    }
  }

  function handleSessionDoubleClick(sessionId: string): void {
    setFocusedSession(sessionId);
    expandFocusedSession();
    vscode.postMessage({ type: 'session:focus', sessionId });
  }

  function handleRefresh(): void {
    vscode.postMessage({ type: 'refresh' });
  }

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        collapseFocusedSession();
      }
    },
    [collapseFocusedSession]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (sessions.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <ConductorHeader
          sessions={sessions}
          tokenSummaries={tokenSummaries}
          onRefresh={handleRefresh}
        />
        <div style={{ flex: 1, overflow: 'auto' }}>
          <EmptyState />
        </div>
      </div>
    );
  }

  const showOverview = detailViewMode !== 'expanded';
  const showDetail = detailViewMode === 'split' || detailViewMode === 'expanded';
  const showCollapsedBar = detailViewMode === 'expanded';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <ConductorHeader
        sessions={sessions}
        tokenSummaries={tokenSummaries}
        onRefresh={handleRefresh}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Collapsed bar (expanded mode) */}
        {showCollapsedBar && focusedSession && (
          <CollapsedBar
            session={focusedSession}
            onExpand={() => collapseFocusedSession()}
          />
        )}

        {/* Overview panel */}
        {showOverview && (
          <div
            style={{
              flex: showDetail ? '0 0 40%' : 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderBottom: showDetail ? '1px solid var(--border)' : undefined,
            }}
          >
            <OverviewPanel
              sessions={filteredSessions}
              tokenSummaries={tokenSummaries}
              focusedSessionId={focusedSessionId}
              onSessionClick={handleSessionClick}
              onSessionDoubleClick={handleSessionDoubleClick}
            />
          </div>
        )}

        {/* Detail panel */}
        {showDetail && focusedSession && (
          <div
            style={{
              flex: detailViewMode === 'expanded' ? 1 : '0 0 60%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <DetailPanel
              session={focusedSession}
              isExpanded={detailViewMode === 'expanded'}
              onToggleExpand={() => {
                if (detailViewMode === 'expanded') {
                  collapseFocusedSession();
                } else {
                  expandFocusedSession();
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
