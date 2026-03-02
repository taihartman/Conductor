import React, { useCallback, useEffect } from 'react';
import type { SessionInfo, ConversationTurn } from '@shared/types';
import { SESSION_STATUSES } from '@shared/sharedConstants';
import { useDashboardStore } from '../store/dashboardStore';
import { SessionStatsBar } from './SessionStatsBar';
import { EnsembleList } from './EnsembleList';
import { ConversationView } from './ConversationView';
import { AnalyticsDrawer } from './AnalyticsDrawer';
import { ChatInput } from './ChatInput';
import { TerminalView } from './TerminalView';
import { isLaunchingSession } from '../utils/sessionContext';
import { vscode } from '../vscode';

interface DetailPanelProps {
  session: SessionInfo;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** When set, reads per-session data from Maps instead of flat arrays. */
  tileSessionId?: string;
}

/** Stable empty array to prevent Zustand selector infinite re-render loops. */
const EMPTY_CONVERSATION: ConversationTurn[] = [];

export function DetailPanel({
  session,
  isExpanded,
  onToggleExpand,
  tileSessionId,
}: DetailPanelProps): React.ReactElement {
  const conversation = useDashboardStore(
    useCallback(
      (s) =>
        tileSessionId
          ? (s.conversationBySession.get(tileSessionId) ?? EMPTY_CONVERSATION)
          : s.conversation,
      [tileSessionId]
    )
  );
  const toolStats = useDashboardStore((s) => s.toolStats);
  const tokenSummaries = useDashboardStore((s) => s.tokenSummaries);
  const filteredSubAgentId = useDashboardStore((s) => s.filteredSubAgentId);
  const setFilteredSubAgentId = useDashboardStore((s) => s.setFilteredSubAgentId);
  const analyticsDrawerOpen = useDashboardStore((s) => s.analyticsDrawerOpen);
  const toggleAnalyticsDrawer = useDashboardStore((s) => s.toggleAnalyticsDrawer);
  const sessions = useDashboardStore((s) => s.sessions);
  const viewMode = useDashboardStore(
    (s) =>
      s.viewModes.get(session.sessionId) ??
      (session.hasActivePty || isLaunchingSession(session) ? 'terminal' : 'conversation')
  );
  const addPendingAdoption = useDashboardStore((s) => s.addPendingAdoption);
  const isAdopting = useDashboardStore((s) => s.pendingAdoptions.has(session.sessionId));
  const isNestedSession = useDashboardStore((s) => s.isNestedSession);

  // Resolve the sub-agent's full SessionInfo for ChatInput approval buttons.
  // Priority: filtered sub-agent > any waiting child agent > none.
  const activeSubAgentSession = (() => {
    if (filteredSubAgentId) {
      return sessions.find((s) => s.sessionId === filteredSubAgentId) ?? null;
    }
    const waitingChild = session.childAgents?.find(
      (c) => c.status === SESSION_STATUSES.WAITING
    );
    if (waitingChild) {
      return sessions.find((s) => s.sessionId === waitingChild.sessionId) ?? null;
    }
    return null;
  })();

  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const viewModes = useDashboardStore((s) => s.viewModes);

  // Auto-switch to terminal when a session gains an active PTY (e.g. after auto-reconnect)
  useEffect(() => {
    if (session.hasActivePty && session.launchedByConductor && !viewModes.has(session.sessionId)) {
      setViewMode(session.sessionId, 'terminal');
    }
  }, [session.hasActivePty, session.launchedByConductor, session.sessionId, viewModes, setViewMode]);

  const isTerminalMode = viewMode === 'terminal';

  // Notify the extension when terminal view is shown/hidden (for keybinding `when` clause)
  useEffect(() => {
    vscode.postMessage({ type: 'terminal:view-changed', active: isTerminalMode });
    return () => {
      vscode.postMessage({ type: 'terminal:view-changed', active: false });
    };
  }, [isTerminalMode]);

  const handleKillTerminal = useCallback(() => {
    vscode.postMessage({ type: 'session:terminal-kill', sessionId: session.sessionId });
  }, [session.sessionId]);

  const handleToggleView = useCallback(() => {
    const targetMode = isTerminalMode ? 'conversation' : 'terminal';
    if (isTerminalMode) {
      // Switching FROM terminal → always set locally
      setViewMode(session.sessionId, targetMode);
    } else if (session.launchedByConductor) {
      // Conductor-launched: set locally (terminal already exists)
      setViewMode(session.sessionId, targetMode);
    } else if (isNestedSession) {
      // Nested session: cannot adopt — SessionLauncher would reject it
      return;
    } else {
      // External session: adopt first, then toggle on success
      addPendingAdoption(session.sessionId);
      vscode.postMessage({ type: 'session:adopt', sessionId: session.sessionId });
    }
  }, [setViewMode, addPendingAdoption, session.sessionId, session.launchedByConductor, isTerminalMode, isNestedSession]);

  // Get cost from token summaries
  const tokenSummary = tokenSummaries.find((t) => t.sessionId === session.sessionId);
  const cost = tokenSummary?.estimatedCostUsd ?? 0;

  // Filter token summaries for this session
  const sessionTokenSummaries = tokenSummaries.filter(
    (t) => t.sessionId === session.sessionId
  );

  // Filter conversation by sub-agent if selected
  const filteredConversation = filteredSubAgentId
    ? conversation.filter((t) => t.sessionId === filteredSubAgentId)
    : conversation;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <SessionStatsBar
        session={session}
        cost={cost}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onToggleAnalytics={toggleAnalyticsDrawer}
        analyticsOpen={analyticsDrawerOpen}
        isTerminalMode={isTerminalMode}
        isAdopting={isAdopting}
        isAdoptDisabled={isNestedSession && !session.launchedByConductor && !isTerminalMode}
        onToggleView={handleToggleView}
        onKillTerminal={session.hasActivePty ? handleKillTerminal : undefined}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Left: Ensemble list */}
        {!isTerminalMode && (session.childAgents ?? []).length > 0 && (
          <div
            style={{
              width: '220px', // inline-ok
              flexShrink: 0,
              borderRight: '1px solid var(--border)',
              overflowY: 'auto',
            }}
          >
            <EnsembleList
              childAgents={session.childAgents ?? []}
              filteredSubAgentId={filteredSubAgentId}
              onSubAgentClick={setFilteredSubAgentId}
            />
          </div>
        )}

        {/* Center: Conversation transcript + chat input OR Terminal view */}
        {isTerminalMode ? (
          <TerminalView sessionId={session.sessionId} />
        ) : (
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <ConversationView
              conversation={filteredConversation}
              continuationTotal={
                session.continuationCount != null
                  ? session.continuationCount + 1
                  : undefined
              }
            />
            <ChatInput
              sessionId={session.sessionId}
              session={session}
              subAgentSession={activeSubAgentSession ?? undefined}
            />
          </div>
        )}

        {/* Right: Analytics drawer */}
        <AnalyticsDrawer
          open={analyticsDrawerOpen}
          onClose={toggleAnalyticsDrawer}
          toolStats={toolStats}
          tokenSummaries={sessionTokenSummaries}
        />
      </div>
    </div>
  );
}
