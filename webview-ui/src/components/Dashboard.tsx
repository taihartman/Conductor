import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { AgentCard } from './AgentCard';
import { ActivityFeed } from './ActivityFeed';
import { ToolStatsPanel } from './ToolStatsPanel';
import { TokenUsagePanel } from './TokenUsagePanel';
import { EmptyState } from './EmptyState';
import { vscode } from '../vscode';
import type { FilterMode } from '../store/dashboardStore';

const FILTER_OPTIONS: { label: string; value: FilterMode }[] = [
  { label: 'Recent', value: 'recent' },
  { label: 'Active', value: 'active' },
  { label: 'All', value: 'all' },
];

const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function Dashboard(): React.ReactElement {
  const sessions = useDashboardStore((s) => s.sessions);
  const focusedSessionId = useDashboardStore((s) => s.focusedSessionId);
  const filterMode = useDashboardStore((s) => s.filterMode);
  const setFocusedSession = useDashboardStore((s) => s.setFocusedSession);
  const setFilterMode = useDashboardStore((s) => s.setFilterMode);

  const filteredSessions = (() => {
    switch (filterMode) {
      case 'active':
        return sessions.filter((s) => s.status === 'active' || s.status === 'waiting');
      case 'recent': {
        const cutoff = Date.now() - RECENT_THRESHOLD_MS;
        return sessions.filter((s) => new Date(s.lastActivityAt).getTime() > cutoff);
      }
      default:
        return sessions;
    }
  })();

  // Separate parent sessions and sub-agents
  const parentSessions = filteredSessions.filter((s) => !s.isSubAgent);
  const subAgentSessions = filteredSessions.filter((s) => s.isSubAgent);

  const activeSessions = sessions.filter((s) => s.status === 'active').length;
  const waitingSessions = sessions.filter(
    (s) => s.status === 'waiting'
  ).length;

  function handleSessionClick(sessionId: string): void {
    const newFocus = focusedSessionId === sessionId ? null : sessionId;
    setFocusedSession(newFocus);
    if (newFocus) {
      vscode.postMessage({ type: 'session:focus', sessionId: newFocus });
    }
  }

  function handleRefresh(): void {
    vscode.postMessage({ type: 'refresh' });
  }

  if (sessions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        padding: 'var(--spacing-md)',
        gap: 'var(--spacing-md)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <h1
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--fg-primary)',
              margin: 0,
            }}
          >
            Claude Agents
          </h1>
          <span
            style={{
              fontSize: '12px',
              color: 'var(--fg-muted)',
            }}
          >
            {activeSessions} active
            {waitingSessions > 0 && ` / ${waitingSessions} waiting`}
            {' / '}
            {sessions.length} total
          </span>
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilterMode(opt.value)}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                borderRadius: '3px',
                border: '1px solid var(--border)',
                backgroundColor:
                  filterMode === opt.value
                    ? 'var(--accent)'
                    : 'var(--bg-card)',
                color:
                  filterMode === opt.value ? '#fff' : 'var(--fg-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={handleRefresh}
            style={{
              padding: '2px 8px',
              fontSize: '11px',
              borderRadius: '3px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--fg-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 260px',
          gap: 'var(--spacing-md)',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Left: Sessions list */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-sm)',
            overflowY: 'auto',
            paddingRight: 'var(--spacing-xs)',
          }}
        >
          {parentSessions.map((session) => (
            <AgentCard
              key={session.sessionId}
              session={session}
              isSelected={focusedSessionId === session.sessionId}
              onClick={() => handleSessionClick(session.sessionId)}
            />
          ))}
          {subAgentSessions.length > 0 && (
            <>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--fg-muted)',
                  padding: 'var(--spacing-xs) 0',
                  borderTop: '1px solid var(--border)',
                  marginTop: 'var(--spacing-xs)',
                }}
              >
                Sub-agents ({subAgentSessions.length})
              </div>
              {subAgentSessions.map((session) => (
                <div
                  key={session.sessionId}
                  style={{ paddingLeft: 'var(--spacing-md)' }}
                >
                  <AgentCard
                    session={session}
                    isSelected={focusedSessionId === session.sessionId}
                    onClick={() => handleSessionClick(session.sessionId)}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        {/* Center: Activity feed */}
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <ActivityFeed />
        </div>

        {/* Right: Stats panels */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-md)',
            overflowY: 'auto',
          }}
        >
          <TokenUsagePanel />
          <ToolStatsPanel />
        </div>
      </div>
    </div>
  );
}
