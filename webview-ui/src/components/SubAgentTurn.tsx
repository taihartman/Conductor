import React from 'react';
import type { ConversationTurn } from '@shared/types';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';

interface SubAgentTurnProps {
  turn: ConversationTurn;
}

export function SubAgentTurn({ turn }: SubAgentTurnProps): React.ReactElement {
  return (
    <div
      style={{
        margin: '4px var(--spacing-md)', // inline-ok
        padding: 'var(--spacing-sm) var(--spacing-md)',
        backgroundColor: COLORS.SUB_AGENT_BG,
        border: `1px solid ${COLORS.SUB_AGENT_BORDER}`,
        borderRadius: '6px', // inline-ok
        fontSize: '12px', // inline-ok
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-sm)',
        }}
      >
        <span style={{ fontSize: '14px' /* inline-ok */ }}>{'\u2937'}</span>
        <span
          style={{
            fontSize: '10px', // inline-ok
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--accent)',
          }}
        >
          {UI_STRINGS.SUB_AGENT_LABEL}
        </span>
        {turn.subAgentSessionId && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px', // inline-ok
              color: 'var(--fg-muted)',
            }}
          >
            {turn.subAgentSessionId.substring(0, 8)}
          </span>
        )}
      </div>
      {turn.subAgentDescription && (
        <div
          style={{
            marginTop: '4px', // inline-ok
            color: 'var(--fg-secondary)',
            lineHeight: 1.4,
          }}
        >
          {turn.subAgentDescription}
        </div>
      )}
    </div>
  );
}
