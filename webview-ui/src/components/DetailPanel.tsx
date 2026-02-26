import React, { useCallback } from 'react';
import type { SessionInfo } from '@shared/types';
import { useDashboardStore } from '../store/dashboardStore';
import { SessionStatsBar } from './SessionStatsBar';
import { EnsembleList } from './EnsembleList';
import { ConversationView } from './ConversationView';
import { AnalyticsDrawer } from './AnalyticsDrawer';
import { ChatInput } from './ChatInput';
import { TerminalView } from './TerminalView';
import { UI_STRINGS } from '../config/strings';

interface DetailPanelProps {
  session: SessionInfo;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function DetailPanel({
  session,
  isExpanded,
  onToggleExpand,
}: DetailPanelProps): React.ReactElement {
  const conversation = useDashboardStore((s) => s.conversation);
  const toolStats = useDashboardStore((s) => s.toolStats);
  const tokenSummaries = useDashboardStore((s) => s.tokenSummaries);
  const filteredSubAgentId = useDashboardStore((s) => s.filteredSubAgentId);
  const setFilteredSubAgentId = useDashboardStore((s) => s.setFilteredSubAgentId);
  const analyticsDrawerOpen = useDashboardStore((s) => s.analyticsDrawerOpen);
  const toggleAnalyticsDrawer = useDashboardStore((s) => s.toggleAnalyticsDrawer);
  const viewMode = useDashboardStore(
    (s) => s.viewModes.get(session.sessionId) ?? 'conversation'
  );
  const toggleViewMode = useDashboardStore((s) => s.toggleViewMode);

  const isTerminalMode = viewMode === 'terminal';
  const canToggle = session.launchedByConductor === true;

  const handleToggleView = useCallback(() => {
    toggleViewMode(session.sessionId);
  }, [toggleViewMode, session.sessionId]);

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
      />

      {/* View mode toggle bar — only for Conductor-launched sessions */}
      {canToggle && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            padding: '4px var(--spacing-md)', // inline-ok
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleToggleView}
            title={UI_STRINGS.TERMINAL_TOGGLE_TOOLTIP}
            style={{
              padding: '2px 8px', // inline-ok
              fontSize: '11px', // inline-ok
              borderRadius: '3px',
              border: '1px solid var(--border)',
              backgroundColor: isTerminalMode ? 'var(--accent, #007acc)' : 'var(--bg-card)',
              color: isTerminalMode ? '#fff' : 'var(--fg-secondary)', // inline-ok: button text
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isTerminalMode
              ? UI_STRINGS.CONVERSATION_VIEW_TOGGLE
              : UI_STRINGS.TERMINAL_VIEW_TOGGLE}
          </button>
        </div>
      )}

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
            <ChatInput sessionId={session.sessionId} session={session} />
          </div>
        )}

        {/* Right: Analytics drawer */}
        {!isTerminalMode && (
          <AnalyticsDrawer
            open={analyticsDrawerOpen}
            onClose={toggleAnalyticsDrawer}
            toolStats={toolStats}
            tokenSummaries={sessionTokenSummaries}
          />
        )}
      </div>
    </div>
  );
}
