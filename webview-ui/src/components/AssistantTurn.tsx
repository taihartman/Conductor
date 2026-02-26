import React from 'react';
import type { ConversationTurn } from '@shared/types';
import { UI_STRINGS } from '../config/strings';
import { formatModel } from '../utils/formatters';
import { ToolBlock } from './ToolBlock';
import { SubAgentTurn } from './SubAgentTurn';
import { MarkdownContent } from './MarkdownContent';

interface AssistantTurnProps {
  turn: ConversationTurn;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AssistantTurn({ turn }: AssistantTurnProps): React.ReactElement {
  const hasSubAgent = turn.subAgentDescription || turn.subAgentSessionId;

  return (
    <div
      style={{
        padding: '8px 20px', // inline-ok
      }}
    >
      {/* Header */}
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
            color: 'var(--fg-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {UI_STRINGS.CONVERSATION_ASSISTANT_LABEL}
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
        {turn.model && (
          <span
            style={{
              fontSize: '10px', // inline-ok
              color: 'var(--fg-muted)',
              padding: '0 4px', // inline-ok
              borderRadius: '3px', // inline-ok
              border: '1px solid var(--border)',
            }}
          >
            {formatModel(turn.model)}
          </span>
        )}
      </div>

      {/* Text content */}
      {turn.text && (
        <div
          style={{
            fontSize: '13px', // inline-ok
            color: 'var(--fg-primary)',
            lineHeight: 1.5,
            wordBreak: 'break-word',
            marginBottom: turn.tools?.length ? '8px' : undefined, // inline-ok
          }}
        >
          <MarkdownContent content={turn.text} />
        </div>
      )}

      {/* Tool blocks */}
      {turn.tools && turn.tools.length > 0 && (
        <div>
          {turn.tools.map((tool) => (
            <ToolBlock key={tool.toolUseId} tool={tool} />
          ))}
        </div>
      )}

      {/* Sub-agent indicator */}
      {hasSubAgent && <SubAgentTurn turn={turn} />}
    </div>
  );
}
