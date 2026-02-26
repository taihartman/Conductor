import React from 'react';
import type { ConversationTurn } from '@shared/types';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';
import { MarkdownContent } from './MarkdownContent';

interface UserTurnProps {
  turn: ConversationTurn;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function UserTurn({ turn }: UserTurnProps): React.ReactElement {
  return (
    <div
      style={{
        padding: 'var(--spacing-sm) var(--spacing-md)',
        backgroundColor: COLORS.USER_INPUT_ROW_BG,
        borderLeft: '3px solid var(--accent)', // inline-ok
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-sm)',
          marginBottom: '4px', // inline-ok
        }}
      >
        <span
          style={{
            fontSize: '11px', // inline-ok
            fontWeight: 700,
            color: 'var(--accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {UI_STRINGS.CONVERSATION_USER_LABEL}
        </span>
        <span
          style={{
            fontSize: '10px', // inline-ok
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {formatTime(turn.timestamp)}
        </span>
      </div>

      {turn.text && (
        <div
          style={{
            fontSize: '13px', // inline-ok
            color: 'var(--fg-primary)',
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          <MarkdownContent content={turn.text} />
        </div>
      )}
    </div>
  );
}
