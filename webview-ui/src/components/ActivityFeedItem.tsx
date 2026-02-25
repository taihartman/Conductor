import React from 'react';
import type { ActivityEvent } from '../store/dashboardStore';

interface ActivityFeedItemProps {
  event: ActivityEvent;
}

const TOOL_ICONS: Record<string, string> = {
  Read: 'file',
  Write: 'new-file',
  Edit: 'edit',
  Bash: 'terminal',
  Glob: 'search',
  Grep: 'search',
  Task: 'rocket',
  WebSearch: 'globe',
  WebFetch: 'globe',
  AskUserQuestion: 'question',
};

function getIcon(event: ActivityEvent): string {
  if (event.type === 'tool_call' && event.toolName) {
    return TOOL_ICONS[event.toolName] || 'symbol-method';
  }
  switch (event.type) {
    case 'tool_result':
      return event.isError ? 'error' : 'check';
    case 'text':
      return 'comment';
    case 'turn_end':
      return 'debug-stop';
    case 'user_input':
      return 'account';
    default:
      return 'circle';
  }
}

function getDescription(event: ActivityEvent): string {
  switch (event.type) {
    case 'tool_call':
      return event.toolInput
        ? `${event.toolName} - ${event.toolInput}`
        : event.toolName || 'Tool call';
    case 'tool_result':
      return event.isError ? 'Error' : 'Completed';
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

export function ActivityFeedItem({
  event,
}: ActivityFeedItemProps): React.ReactElement {
  const isError = event.type === 'tool_result' && event.isError;
  const isTurnEnd = event.type === 'turn_end';
  const isUserInput = event.type === 'user_input';

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--spacing-sm)',
        padding: '4px var(--spacing-sm)',
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
          color: isError ? '#dc3545' : 'var(--fg-secondary)',
        }}
        className={`codicon codicon-${getIcon(event)}`}
        title={event.type}
      >
        {event.type === 'tool_call'
          ? '\u25B6'
          : event.type === 'tool_result'
            ? event.isError
              ? '\u2718'
              : '\u2714'
            : event.type === 'turn_end'
              ? '\u25A0'
              : event.type === 'user_input'
                ? '\u25CF'
                : '\u25CB'}
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
          color: isError ? '#dc3545' : 'var(--fg-secondary)',
        }}
        title={getDescription(event)}
      >
        {getDescription(event)}
      </span>
    </div>
  );
}
