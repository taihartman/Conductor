import React from 'react';
import type { ActivityEvent } from '@shared/types';

interface LiveFeedItemProps {
  event: ActivityEvent;
}

function getDescription(event: ActivityEvent): string {
  switch (event.type) {
    case 'tool_call':
      return event.toolInput
        ? `${event.toolName} - ${event.toolInput}`
        : event.toolName || 'Tool call';
    case 'tool_result':
      if (event.isError) {
        return event.errorMessage ? `Error: ${event.errorMessage}` : 'Error';
      }
      return 'Completed';
    case 'text':
      return event.text || '';
    case 'turn_end':
      return event.durationMs
        ? `Turn completed (${(event.durationMs / 1000).toFixed(1)}s)`
        : 'Turn completed';
    case 'user_input':
      return event.text || 'User message';
    default:
      return '';
  }
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getIcon(event: ActivityEvent): string {
  if (event.type === 'tool_call') return '\u25B6';
  if (event.type === 'tool_result') return event.isError ? '\u2718' : '\u2714';
  if (event.type === 'turn_end') return '\u25A0';
  if (event.type === 'user_input') return '\u25CF';
  return '\u25CB';
}

export function LiveFeedItem({ event }: LiveFeedItemProps): React.ReactElement {
  const isError = event.type === 'tool_result' && event.isError;
  const isTurnEnd = event.type === 'turn_end';
  const isUserInput = event.type === 'user_input';

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--spacing-sm)',
        padding: '3px var(--spacing-sm)',
        fontSize: '12px',
        borderBottom: '1px solid var(--border)',
        opacity: isTurnEnd ? 0.6 : 1,
        backgroundColor: isError
          ? 'rgba(220, 53, 69, 0.1)'
          : isUserInput
            ? 'rgba(0, 122, 204, 0.05)'
            : undefined,
      }}
    >
      <span
        style={{
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          whiteSpace: 'nowrap',
          minWidth: '65px',
        }}
      >
        {formatTime(event.timestamp)}
      </span>

      <span
        style={{
          width: '16px',
          textAlign: 'center',
          color: isError ? 'var(--status-error)' : 'var(--fg-secondary)',
        }}
        title={event.type}
      >
        {getIcon(event)}
      </span>

      <span
        style={{
          color: 'var(--fg-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          minWidth: '60px',
          maxWidth: '60px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={event.sessionSlug}
      >
        {event.sessionSlug}
      </span>

      {event.type === 'tool_call' && event.toolName && (
        <span
          style={{
            display: 'inline-block',
            padding: '0 4px',
            borderRadius: '3px',
            backgroundColor: 'rgba(0, 122, 204, 0.15)',
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            whiteSpace: 'nowrap',
          }}
        >
          {event.toolName}
        </span>
      )}

      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: isError ? 'var(--status-error)' : 'var(--fg-secondary)',
        }}
        title={getDescription(event)}
      >
        {getDescription(event)}
      </span>
    </div>
  );
}
