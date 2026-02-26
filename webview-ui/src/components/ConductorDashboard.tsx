import React, { useCallback, useEffect, useRef } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { STATUS_GROUPS } from '@shared/sharedConstants';
import { useDashboardStore, DETAIL_VIEW_MODES } from '../store/dashboardStore';
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
const PANEL_DEFAULT_LAYOUT: Layout = { overview: 40, detail: 60 };
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
  const panelLayout = useDashboardStore((s) => s.panelLayout);
  const setPanelLayout = useDashboardStore((s) => s.setPanelLayout);
  const zenModeActive = useDashboardStore((s) => s.zenModeActive);
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);
  const zenExitedAt = useDashboardStore((s) => s.zenExitedAt);
  const enterZenMode = useDashboardStore((s) => s.enterZenMode);
  const exitZenMode = useDashboardStore((s) => s.exitZenMode);
  const showArtifacts = useDashboardStore((s) => s.showArtifacts);
  const toggleShowArtifacts = useDashboardStore((s) => s.toggleShowArtifacts);

  // Centralized visibility filter: exclude sub-agents and (optionally) artifacts
  const visibleSessions = sessions.filter((s) => {
    if (s.isSubAgent) return false;
    if (s.isArtifact && !showArtifacts) return false;
    return true;
  });
  const artifactCount = sessions.filter((s) => s.isArtifact && !s.isSubAgent).length;

  const { nudgeActive, autoZenTriggered, resetIdle } = useZenNudge(visibleSessions, zenExitedAt);
  const completionCount = useCompletionDetector(visibleSessions);
  const mascotButtonRef = useRef<HTMLButtonElement>(null);

  // Filter sessions (operates on pre-filtered visibleSessions)
  const filteredSessions = (() => {
    switch (filterMode) {
      case 'active':
        return visibleSessions.filter(
          (s) => STATUS_GROUPS.ACTIVE_FILTER.has(s.status)
        );
      case 'recent': {
        const cutoff = Date.now() - RECENT_THRESHOLD_MS;
        return visibleSessions.filter((s) => new Date(s.lastActivityAt).getTime() > cutoff);
      }
      default:
        return visibleSessions;
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

  function handleLaunchSession(): void {
    vscode.postMessage({ type: 'session:launch' });
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
          sessions={visibleSessions}
          tokenSummaries={tokenSummaries}
          onRefresh={handleRefresh}
          onLaunchSession={handleLaunchSession}
          nudgeActive={false}
          onMascotClick={enterZenMode}
          mascotButtonRef={mascotButtonRef}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          artifactCount={artifactCount}
          showArtifacts={showArtifacts}
          onToggleArtifacts={toggleShowArtifacts}
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
        sessions={visibleSessions}
        tokenSummaries={tokenSummaries}
        onRefresh={handleRefresh}
        onLaunchSession={handleLaunchSession}
        nudgeActive={nudgeActive}
        onMascotClick={enterZenMode}
        mascotButtonRef={mascotButtonRef}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        layoutOrientation={layoutOrientation}
        onToggleOrientation={toggleLayoutOrientation}
        showOrientationToggle={detailViewMode === DETAIL_VIEW_MODES.SPLIT}
        artifactCount={artifactCount}
        showArtifacts={showArtifacts}
        onToggleArtifacts={toggleShowArtifacts}
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
          {detailViewMode === DETAIL_VIEW_MODES.EXPANDED && focusedSession && (
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
          {detailViewMode === DETAIL_VIEW_MODES.SPLIT && focusedSession && (
            <Group
              orientation={layoutOrientation}
              defaultLayout={panelLayout ?? PANEL_DEFAULT_LAYOUT}
              onLayoutChanged={setPanelLayout}
              style={{ flex: 1, overflow: 'hidden' }}
            >
              <Panel
                id="overview"
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
          {detailViewMode === DETAIL_VIEW_MODES.OVERVIEW_ONLY && (
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
