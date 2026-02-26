import React from 'react';
import type { SessionInfo } from '@shared/types';
import { useDashboardStore } from '../store/dashboardStore';
import { SessionStatsBar } from './SessionStatsBar';
import { EnsembleList } from './EnsembleList';
import { ConversationView } from './ConversationView';
import { AnalyticsDrawer } from './AnalyticsDrawer';

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

      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Left: Ensemble list */}
        {(session.childAgents ?? []).length > 0 && (
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

        {/* Center: Conversation transcript */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <ConversationView conversation={filteredConversation} />
        </div>

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
