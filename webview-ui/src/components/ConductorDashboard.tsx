import React, { useCallback, useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useDashboardStore } from '../store/dashboardStore';
import { ConductorHeader } from './ConductorHeader';
import { OverviewPanel } from './OverviewPanel';
import { DetailPanel } from './DetailPanel';
import { CollapsedBar } from './CollapsedBar';
import { EmptyState } from './EmptyState';
import { ZenModeScene } from './ZenModeScene';
import { useZenNudge } from '../hooks/useZenNudge';
import { useCompletionDetector } from '../hooks/useCompletionDetector';
import { matchesSearchQuery } from '../utils/sessionFilter';
import { vscode } from '../vscode';

const RECENT_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const PANEL_DEFAULT_OVERVIEW = '40%';
const PANEL_DEFAULT_DETAIL = '60%';
const PANEL_MIN_SIZE = '15%';
const PANEL_MAX_SIZE = '85%';

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
  const layoutOrientation = useDashboardStore((s) => s.layoutOrientation);
  const toggleLayoutOrientation = useDashboardStore((s) => s.toggleLayoutOrientation);
  const zenModeActive = useDashboardStore((s) => s.zenModeActive);
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);
  const zenExitedAt = useDashboardStore((s) => s.zenExitedAt);
  const enterZenMode = useDashboardStore((s) => s.enterZenMode);
  const exitZenMode = useDashboardStore((s) => s.exitZenMode);

  const { nudgeActive, autoZenTriggered, resetIdle } = useZenNudge(sessions, zenExitedAt);
  const completionCount = useCompletionDetector(sessions);
  const mascotButtonRef = useRef<HTMLButtonElement>(null);

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
  })().filter((s) => matchesSearchQuery(s, searchQuery));

  // Find focused session
  const focusedSession = focusedSessionId
    ? sessions.find((s) => s.sessionId === focusedSessionId)
    : undefined;

  // Handlers
  function handleSessionClick(sessionId: string): void {
    if (focusedSessionId === sessionId) {
      clearFocus();
      vscode.postMessage({ type: 'session:focus', sessionId: null });
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

  function handleRename(sessionId: string, name: string): void {
    vscode.postMessage({ type: 'session:rename', sessionId, name });
  }

  function handleReorder(sessionIds: string[]): void {
    vscode.postMessage({ type: 'session:reorder', sessionIds });
  }

  function handleRefresh(): void {
    vscode.postMessage({ type: 'refresh' });
  }

  const handleZenExit = useCallback(() => {
    resetIdle();
    exitZenMode();
    mascotButtonRef.current?.focus();
  }, [resetIdle, exitZenMode]);

  // Escape key handler — zen mode takes priority
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zenModeActive) {
          handleZenExit();
        } else {
          collapseFocusedSession();
        }
      }
    },
    [zenModeActive, handleZenExit, collapseFocusedSession]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-enter zen mode after prolonged idle
  useEffect(() => {
    if (autoZenTriggered && !zenModeActive && sessions.length > 0) {
      enterZenMode();
    }
  }, [autoZenTriggered, zenModeActive, enterZenMode, sessions.length]);

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
          nudgeActive={false}
          onMascotClick={enterZenMode}
          mascotButtonRef={mascotButtonRef}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <div style={{ flex: 1, overflow: 'auto' }}>
          <EmptyState />
        </div>
      </div>
    );
  }

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
        nudgeActive={nudgeActive}
        onMascotClick={enterZenMode}
        mascotButtonRef={mascotButtonRef}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        layoutOrientation={layoutOrientation}
        onToggleOrientation={toggleLayoutOrientation}
        showOrientationToggle={detailViewMode === 'split'}
      />

      {zenModeActive ? (
        <ZenModeScene completionCount={completionCount} onExit={handleZenExit} />
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {/* Expanded mode: collapsed bar + full detail */}
          {detailViewMode === 'expanded' && focusedSession && (
            <>
              <CollapsedBar
                session={focusedSession}
                onExpand={() => collapseFocusedSession()}
              />
              <div
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <DetailPanel
                  session={focusedSession}
                  isExpanded={true}
                  onToggleExpand={collapseFocusedSession}
                />
              </div>
            </>
          )}

          {/* Split mode: resizable panels */}
          {detailViewMode === 'split' && focusedSession && (
            <Group
              orientation={layoutOrientation}
              style={{ flex: 1, overflow: 'hidden' }}
            >
              <Panel
                id="overview"
                defaultSize={PANEL_DEFAULT_OVERVIEW}
                minSize={PANEL_MIN_SIZE}
                maxSize={PANEL_MAX_SIZE}
                style={{
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  minWidth: 0,
                }}
              >
                <OverviewPanel
                  sessions={filteredSessions}
                  tokenSummaries={tokenSummaries}
                  focusedSessionId={focusedSessionId}
                  onSessionClick={handleSessionClick}
                  onSessionDoubleClick={handleSessionDoubleClick}
                  onRename={handleRename}
                  onReorder={handleReorder}
                  searchQuery={searchQuery}
                />
              </Panel>
              <Separator />
              <Panel
                id="detail"
                defaultSize={PANEL_DEFAULT_DETAIL}
                minSize={PANEL_MIN_SIZE}
                maxSize={PANEL_MAX_SIZE}
                style={{
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  minWidth: 0,
                }}
              >
                <DetailPanel
                  session={focusedSession}
                  isExpanded={false}
                  onToggleExpand={expandFocusedSession}
                />
              </Panel>
            </Group>
          )}

          {/* Overview-only mode: no resize needed */}
          {detailViewMode === 'overview-only' && (
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <OverviewPanel
                sessions={filteredSessions}
                tokenSummaries={tokenSummaries}
                focusedSessionId={focusedSessionId}
                onSessionClick={handleSessionClick}
                onSessionDoubleClick={handleSessionDoubleClick}
                onRename={handleRename}
                onReorder={handleReorder}
                searchQuery={searchQuery}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
