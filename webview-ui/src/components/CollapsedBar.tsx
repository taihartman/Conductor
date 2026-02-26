import React from 'react';
import type { SessionInfo } from '@shared/types';
import { StatusDot } from './StatusDot';
import { STATUS_CONFIG } from '../config/statusConfig';
import { formatModel, getSessionDisplayName } from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';

interface CollapsedBarProps {
  session: SessionInfo;
  onExpand: () => void;
}

export function CollapsedBar({ session, onExpand }: CollapsedBarProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: '4px var(--spacing-md)',
        height: '32px', // inline-ok
        flexShrink: 0,
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        fontSize: '12px', // inline-ok
      }}
      onClick={onExpand}
      title="Click to show overview" // inline-ok
    >
      <StatusDot status={session.status} size={6} />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color: 'var(--fg-primary)',
        }}
        title={session.slug}
      >
        {getSessionDisplayName(session)}
      </span>
      <span
        style={{
          fontSize: '10px', // inline-ok
          fontWeight: 600,
          textTransform: 'uppercase',
          color: `var(${config.cssVar})`,
        }}
      >
        {config.label}
      </span>
      {session.model && (
        <span style={{ color: 'var(--fg-muted)' }}>{formatModel(session.model)}</span>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--fg-muted)', fontSize: '11px' /* inline-ok */ }}>
        {UI_STRINGS.COLLAPSE_HINT}
      </span>
    </div>
  );
}
