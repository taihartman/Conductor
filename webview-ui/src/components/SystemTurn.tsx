import React from 'react';
import type { ConversationTurn } from '@shared/types';
import { COLORS } from '../config/colors';
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
        padding: '4px var(--spacing-md)', // inline-ok
        fontSize: '11px', // inline-ok
        color: 'var(--fg-muted)',
        borderTop: `1px solid ${COLORS.SYSTEM_TURN_BORDER}`,
        borderBottom: `1px solid ${COLORS.SYSTEM_TURN_BORDER}`,
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
