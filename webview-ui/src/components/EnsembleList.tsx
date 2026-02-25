import React from 'react';
import type { SubAgentInfo } from '@shared/types';
import { EnsembleRow } from './EnsembleRow';

interface EnsembleListProps {
  childAgents: SubAgentInfo[];
  filteredSubAgentId: string | null;
  onSubAgentClick: (id: string) => void;
}

export function EnsembleList({
  childAgents,
  filteredSubAgentId,
  onSubAgentClick,
}: EnsembleListProps): React.ReactElement {
  if (childAgents.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-md)',
          color: 'var(--fg-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        No sub-agents
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        overflowY: 'auto',
        padding: 'var(--spacing-xs)',
      }}
    >
      <div
        style={{
          padding: '4px var(--spacing-sm)',
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--fg-muted)',
        }}
      >
        Sub-agents ({childAgents.length})
      </div>
      {childAgents.map((agent) => (
        <EnsembleRow
          key={agent.sessionId}
          agent={agent}
          isSelected={filteredSubAgentId === agent.sessionId}
          onClick={() => onSubAgentClick(agent.sessionId)}
        />
      ))}
    </div>
  );
}
