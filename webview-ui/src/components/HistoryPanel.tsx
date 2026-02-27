import React, { useState, useMemo } from 'react';
import type { HistoryEntry } from '@shared/types';
import { UI_STRINGS } from '../config/strings';
import { timeAgo } from '../utils/formatters';
import { vscode } from '../vscode';

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onFocusActiveSession: (sessionId: string) => void;
}

/**
 * Displays a searchable list of previously launched Conductor sessions.
 * Each entry shows the session name, project directory, relative time,
 * and a Resume button (or Active badge for live sessions).
 */
export function HistoryPanel({
  entries,
  onFocusActiveSession,
}: HistoryPanelProps): React.ReactElement {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const lower = filter.toLowerCase();
    return entries.filter(
      (e) =>
        e.displayName.toLowerCase().includes(lower) ||
        e.cwd.toLowerCase().includes(lower)
    );
  }, [entries, filter]);

  if (entries.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--fg-muted)',
          gap: 'var(--spacing-sm)',
          padding: 'var(--spacing-lg)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600 /* inline-ok */ }}>
          {UI_STRINGS.HISTORY_EMPTY_TITLE}
        </div>
        <div style={{ fontSize: '12px', textAlign: 'center' /* inline-ok */ }}>
          {UI_STRINGS.HISTORY_EMPTY_DESCRIPTION}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Search filter */}
      <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', flexShrink: 0 }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={UI_STRINGS.HISTORY_SEARCH_PLACEHOLDER}
          aria-label={UI_STRINGS.HISTORY_SEARCH_PLACEHOLDER}
          style={{
            width: '100%',
            padding: '4px 8px', // inline-ok
            fontSize: '12px', // inline-ok
            fontFamily: 'var(--font-mono)',
            borderRadius: '3px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--fg-primary)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Entry list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 var(--spacing-md)' }}>
        {filtered.map((entry) => (
          <HistoryRow
            key={entry.sessionId}
            entry={entry}
            onResume={handleResume}
            onFocusActive={onFocusActiveSession}
          />
        ))}
      </div>
    </div>
  );
}

function handleResume(sessionId: string): void {
  vscode.postMessage({ type: 'history:resume', sessionId });
}

function HistoryRow({
  entry,
  onResume,
  onFocusActive,
}: {
  entry: HistoryEntry;
  onResume: (sessionId: string) => void;
  onFocusActive: (sessionId: string) => void;
}): React.ReactElement {
  const cwdBasename = entry.cwd.split('/').pop() || entry.cwd;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 0', // inline-ok
        borderBottom: '1px solid var(--border)',
        gap: 'var(--spacing-sm)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '12px', // inline-ok
            fontWeight: 600,
            color: 'var(--fg-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.displayName}
        </div>
        <div
          style={{
            fontSize: '11px', // inline-ok
            color: 'var(--fg-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cwdBasename} · {timeAgo(entry.lastActivityAt)}
        </div>
      </div>

      {entry.isActive ? (
        <button
          onClick={() => onFocusActive(entry.sessionId)}
          style={{
            padding: '2px 8px', // inline-ok
            fontSize: '11px', // inline-ok
            borderRadius: '3px',
            border: '1px solid var(--accent)',
            backgroundColor: 'transparent',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {UI_STRINGS.HISTORY_ACTIVE_BADGE}
        </button>
      ) : (
        <button
          onClick={() => onResume(entry.sessionId)}
          style={{
            padding: '2px 8px', // inline-ok
            fontSize: '11px', // inline-ok
            borderRadius: '3px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--fg-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          {UI_STRINGS.HISTORY_RESUME_BUTTON}
        </button>
      )}
    </div>
  );
}
