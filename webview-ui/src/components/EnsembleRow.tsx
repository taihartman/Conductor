import React from 'react';
import type { SubAgentInfo } from '@shared/types';
import { StatusDot } from './StatusDot';

interface EnsembleRowProps {
  agent: SubAgentInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function EnsembleRow({ agent, isSelected, onClick }: EnsembleRowProps): React.ReactElement {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px var(--spacing-sm)',
        cursor: 'pointer',
        backgroundColor: isSelected ? 'rgba(0, 122, 204, 0.12)' : undefined, // inline-ok
        borderRadius: '3px',
        fontSize: '11px', // inline-ok
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'; // inline-ok
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = '';
        }
      }}
    >
      <StatusDot status={agent.status} size={6} />
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: isSelected ? 'var(--fg-primary)' : 'var(--fg-secondary)',
        }}
        title={agent.description}
      >
        {agent.description.length > 50
          ? agent.description.substring(0, 50) + '...'
          : agent.description}
      </span>
    </div>
  );
}
