import React, { useState } from 'react';
import type { SessionInfo } from '@shared/types';
import { useDashboardStore } from '../store/dashboardStore';
import { SessionStatsBar } from './SessionStatsBar';
import { EnsembleList } from './EnsembleList';
import { LiveFeed } from './LiveFeed';
import { DetailTabs } from './DetailTabs';
import type { DetailTab } from './DetailTabs';
import { ToolStatsPanelInline } from './ToolStatsPanelInline';
import { TokenUsagePanelInline } from './TokenUsagePanelInline';

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
  const activities = useDashboardStore((s) => s.activities);
  const toolStats = useDashboardStore((s) => s.toolStats);
  const tokenSummaries = useDashboardStore((s) => s.tokenSummaries);
  const filteredSubAgentId = useDashboardStore((s) => s.filteredSubAgentId);
  const setFilteredSubAgentId = useDashboardStore((s) => s.setFilteredSubAgentId);

  const [activeTab, setActiveTab] = useState<DetailTab>('feed');

  // Get cost from token summaries
  const tokenSummary = tokenSummaries.find((t) => t.sessionId === session.sessionId);
  const cost = tokenSummary?.estimatedCostUsd ?? 0;

  // Filter activities for focused session (and optionally sub-agent)
  const sessionActivities = activities.filter((a) => {
    if (a.sessionId !== session.sessionId) return false;
    if (filteredSubAgentId && a.sessionSlug) {
      const subAgent = (session.childAgents ?? []).find((c) => c.sessionId === filteredSubAgentId);
      if (subAgent) {
        return a.sessionSlug === subAgent.slug;
      }
    }
    return true;
  });

  // Filter token summaries for this session
  const sessionTokenSummaries = tokenSummaries.filter(
    (t) => t.sessionId === session.sessionId
  );

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
      />

      <DetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

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
              width: '220px',
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

        {/* Right: Tab content */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {activeTab === 'feed' && <LiveFeed activities={sessionActivities} />}
          {activeTab === 'tools' && <ToolStatsPanelInline toolStats={toolStats} />}
          {activeTab === 'tokens' && (
            <TokenUsagePanelInline tokenSummaries={sessionTokenSummaries} />
          )}
        </div>
      </div>
    </div>
  );
}
