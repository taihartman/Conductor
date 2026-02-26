import React from 'react';
import type { ConversationTurn } from '@shared/types';
import { UI_STRINGS } from '../config/strings';
import { formatDuration } from '../utils/formatters';

interface SystemTurnProps {
  turn: ConversationTurn;
}

export function SystemTurn({ turn }: SystemTurnProps): React.ReactElement {
  const label =
    turn.systemEvent === 'turn_end'
      ? turn.durationMs
        ? `${UI_STRINGS.TURN_COMPLETED} — ${formatDuration(turn.durationMs)}`
        : UI_STRINGS.TURN_COMPLETED
      : UI_STRINGS.SUMMARY_LABEL;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: '4px 20px', // inline-ok
        fontSize: '11px', // inline-ok
        color: 'var(--fg-muted)',
        fontStyle: 'italic',
        opacity: 0.8, // inline-ok
      }}
    >
      <span style={{ opacity: 0.6 }}>{'—'}</span>
      <span>{label}</span>
      {turn.summary && (
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontStyle: 'italic',
          }}
          title={turn.summary}
        >
          {turn.summary}
        </span>
      )}
    </div>
  );
}
