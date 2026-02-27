import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { STATUS_GROUPS, SESSION_STATUSES } from '@shared/sharedConstants';
import type { LaunchMode } from '@shared/sharedConstants';
import { useDashboardStore, DETAIL_VIEW_MODES } from '../store/dashboardStore';
import { ConductorHeader } from './ConductorHeader';
import { OverviewPanel } from './OverviewPanel';
import { DetailPanel } from './DetailPanel';
import { CollapsedBar } from './CollapsedBar';
import { EmptyState } from './EmptyState';
import { ZenModeScene } from './ZenModeScene';
import { SettingsDrawer } from './SettingsDrawer';
import { HistoryPanel } from './HistoryPanel';
import { UsagePanel } from './UsagePanel';
import { useZenNudge } from '../hooks/useZenNudge';
import { useCompletionDetector } from '../hooks/useCompletionDetector';
import { matchesSearchQuery } from '../utils/sessionFilter';
import { isLaunchingSession } from '../utils/sessionContext';
import { UI_STRINGS } from '../config/strings';
import type { SessionInfo } from '@shared/types';
import { vscode } from '../vscode';

const RECENT_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const PANEL_DEFAULT_LAYOUT: Layout = { overview: 40, detail: 60 };
const PANEL_MIN_SIZE = '15%';
const PANEL_MAX_SIZE = '85%';
const NOOP = (): void => {};

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
  const activeTab = useDashboardStore((s) => s.activeTab);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const isNestedSession = useDashboardStore((s) => s.isNestedSession);
  const settingsDrawerOpen = useDashboardStore((s) => s.settingsDrawerOpen);
  const toggleSettingsDrawer = useDashboardStore((s) => s.toggleSettingsDrawer);
  const autoHidePatterns = useDashboardStore((s) => s.autoHidePatterns);
  const launchMode = useDashboardStore((s) => s.launchMode);
  const setLaunchMode = useDashboardStore((s) => s.setLaunchMode);
  const historyEntries = useDashboardStore((s) => s.historyEntries);
  const usageData = useDashboardStore((s) => s.usageData);
  const pendingLaunchSessionId = useDashboardStore((s) => s.pendingLaunchSessionId);

  // Tab-based filtering: main sessions vs hidden sessions
  const mainSessions = sessions.filter((s) => !s.isSubAgent && !s.isHidden);
  const hiddenSessions = sessions.filter((s) => !s.isSubAgent && s.isHidden);

  // Remap launching sessions so they appear active everywhere (Kanban, StatusDot, etc.)
  const effectiveMainSessions = useMemo(
    () =>
      mainSessions.map((s) =>
        isLaunchingSession(s) ? { ...s, status: SESSION_STATUSES.WORKING } : s
      ),
    [mainSessions]
  );

  // Prepend a synthetic placeholder card while the JSONL file hasn't appeared yet
  const mainSessionsWithPlaceholder = useMemo(() => {
    if (!pendingLaunchSessionId || sessions.some((s) => s.sessionId === pendingLaunchSessionId)) {
      return effectiveMainSessions;
    }
    const placeholder: SessionInfo = {
      sessionId: pendingLaunchSessionId,
      slug: pendingLaunchSessionId.substring(0, 8), // inline-ok
      summary: '',
      status: SESSION_STATUSES.WORKING,
      model: '',
      gitBranch: '',
      cwd: '',
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      turnCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      isSubAgent: false,
      isArtifact: false,
      filePath: '',
      launchedByConductor: true,
      autoName: UI_STRINGS.LAUNCHING_PLACEHOLDER_NAME,
    };
    return [placeholder, ...effectiveMainSessions];
  }, [pendingLaunchSessionId, sessions, effectiveMainSessions]);

  const tabSessions = activeTab === 'sessions' ? mainSessionsWithPlaceholder : activeTab === 'hidden' ? hiddenSessions : mainSessionsWithPlaceholder;

  /** Wraps setActiveTab to send data requests when switching tabs. */
  function handleTabChange(tab: 'sessions' | 'hidden' | 'history' | 'usage'): void {
    setActiveTab(tab);
    if (tab === 'history') {
      vscode.postMessage({ type: 'history:request' });
    } else if (tab === 'usage') {
      vscode.postMessage({ type: 'usage:request' });
    }
  }

  /** Focus an active session from the history tab. */
  function handleFocusActiveSession(sessionId: string): void {
    setActiveTab('sessions');
    setFocusedSession(sessionId);
    vscode.postMessage({ type: 'session:focus', sessionId });
  }

  const { nudgeActive, autoZenTriggered, resetIdle } = useZenNudge(mainSessionsWithPlaceholder, zenExitedAt);
  const completionCount = useCompletionDetector(mainSessionsWithPlaceholder);
  const mascotButtonRef = useRef<HTMLButtonElement>(null);

  // Filter sessions (operates on active tab's sessions)
  const filteredSessions = (() => {
    switch (filterMode) {
      case 'active':
        return tabSessions.filter(
          (s) => STATUS_GROUPS.ACTIVE_FILTER.has(s.status)
        );
      case 'recent': {
        const cutoff = Date.now() - RECENT_THRESHOLD_MS;
        return tabSessions.filter((s) => new Date(s.lastActivityAt).getTime() > cutoff);
      }
      default:
        return tabSessions;
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

  function handleHideSession(sessionId: string): void {
    if (focusedSessionId === sessionId) {
      clearFocus();
      vscode.postMessage({ type: 'session:focus', sessionId: null });
    }
    vscode.postMessage({ type: 'session:hide', sessionId });
  }

  function handleUnhideSession(sessionId: string): void {
    vscode.postMessage({ type: 'session:unhide', sessionId });
  }

  function handleLaunchSession(mode: LaunchMode): void {
    vscode.postMessage({ type: 'session:launch', mode });
  }

  function handleLaunchModeChange(mode: LaunchMode): void {
    setLaunchMode(mode);
    vscode.postMessage({ type: 'session:set-launch-mode', mode });
  }

  function handleUpdatePatterns(patterns: string[]): void {
    vscode.postMessage({ type: 'settings:update', autoHidePatterns: patterns });
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

  // Auto-switch to "sessions" tab when hidden tab becomes empty (not from history tab)
  useEffect(() => {
    if (hiddenSessions.length === 0 && activeTab === 'hidden') {
      setActiveTab('sessions');
    }
  }, [hiddenSessions.length, activeTab, setActiveTab]);

  // Auto-enter zen mode after prolonged idle
  useEffect(() => {
    if (autoZenTriggered && !zenModeActive && sessions.length > 0) {
      enterZenMode();
    }
  }, [autoZenTriggered, zenModeActive, enterZenMode, sessions.length]);

  if (sessions.length === 0 && !pendingLaunchSessionId) {
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
          sessions={mainSessionsWithPlaceholder}
          tokenSummaries={tokenSummaries}
          onRefresh={handleRefresh}
          onLaunchSession={handleLaunchSession}
          onLaunchModeChange={handleLaunchModeChange}
          launchMode={launchMode}
          nudgeActive={false}
          onMascotClick={enterZenMode}
          mascotButtonRef={mascotButtonRef}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          hiddenCount={hiddenSessions.length}
          isNestedSession={isNestedSession}
          onToggleSettings={toggleSettingsDrawer}
        />
        <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <EmptyState />
          </div>
          <SettingsDrawer
            open={settingsDrawerOpen}
            onClose={toggleSettingsDrawer}
            autoHidePatterns={autoHidePatterns}
            onUpdatePatterns={handleUpdatePatterns}
          />
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
        sessions={mainSessions}
        tokenSummaries={tokenSummaries}
        onRefresh={handleRefresh}
        onLaunchSession={handleLaunchSession}
        onLaunchModeChange={handleLaunchModeChange}
        launchMode={launchMode}
        nudgeActive={nudgeActive}
        onMascotClick={enterZenMode}
        mascotButtonRef={mascotButtonRef}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        layoutOrientation={layoutOrientation}
        onToggleOrientation={toggleLayoutOrientation}
        showOrientationToggle={detailViewMode !== DETAIL_VIEW_MODES.EXPANDED}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hiddenCount={hiddenSessions.length}
        isNestedSession={isNestedSession}
        onToggleSettings={toggleSettingsDrawer}
      />

      {zenModeActive ? (
        <ZenModeScene completionCount={completionCount} onExit={handleZenExit} />
      ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
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
          {detailViewMode === DETAIL_VIEW_MODES.EXPANDED && focusedSession && (activeTab === 'sessions' || activeTab === 'hidden') && (
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
          {detailViewMode === DETAIL_VIEW_MODES.SPLIT && focusedSession && (activeTab === 'sessions' || activeTab === 'hidden') && (
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
                  onHide={handleHideSession}
                  onUnhide={handleUnhideSession}
                  isHiddenTab={activeTab === 'hidden'}
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

          {/* Overview-only mode: split with decorative zen scene */}
          {detailViewMode === DETAIL_VIEW_MODES.OVERVIEW_ONLY && (activeTab === 'sessions' || activeTab === 'hidden') && (
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
                  onHide={handleHideSession}
                  onUnhide={handleUnhideSession}
                  isHiddenTab={activeTab === 'hidden'}
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
                <ZenModeScene completionCount={completionCount} onExit={NOOP} decorative />
              </Panel>
            </Group>
          )}

          {/* History tab: shows archived sessions */}
          {activeTab === 'history' && (
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <HistoryPanel
                entries={historyEntries}
                onFocusActiveSession={handleFocusActiveSession}
              />
            </div>
          )}

          {/* Usage tab: aggregate stats from stats-cache.json */}
          {activeTab === 'usage' && (
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <UsagePanel stats={usageData} />
            </div>
          )}
        </div>
        <SettingsDrawer
          open={settingsDrawerOpen}
          onClose={toggleSettingsDrawer}
          autoHidePatterns={autoHidePatterns}
          onUpdatePatterns={handleUpdatePatterns}
        />
        </div>
      )}
    </div>
  );
}
