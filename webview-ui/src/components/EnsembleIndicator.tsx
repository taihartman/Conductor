import React from 'react';
import type { SubAgentInfo } from '@shared/types';
import { StatusDot } from './StatusDot';

interface EnsembleIndicatorProps {
  childAgents: SubAgentInfo[];
}

export function EnsembleIndicator({ childAgents }: EnsembleIndicatorProps): React.ReactElement {
  if (childAgents.length === 0) return <></>;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '11px',
        color: 'var(--fg-muted)',
      }}
      title={`${childAgents.length} sub-agent${childAgents.length !== 1 ? 's' : ''}`}
    >
      {childAgents.slice(0, 5).map((agent) => (
        <StatusDot key={agent.sessionId} status={agent.status} size={5} />
      ))}
      {childAgents.length > 5 && (
        <span style={{ fontSize: '10px' }}>+{childAgents.length - 5}</span>
      )}
      <span style={{ marginLeft: '2px' }}>
        {childAgents.length} agent{childAgents.length !== 1 ? 's' : ''}
      </span>
    </span>
  );
}
