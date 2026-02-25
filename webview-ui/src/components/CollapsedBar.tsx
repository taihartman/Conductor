import React from 'react';
import type { SessionInfo } from '@shared/types';
import { StatusDot } from './StatusDot';
import { STATUS_CONFIG } from '../config/statusConfig';

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
        height: '32px',
        flexShrink: 0,
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        fontSize: '12px',
      }}
      onClick={onExpand}
      title="Click to show overview"
    >
      <StatusDot status={session.status} size={6} />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color: 'var(--fg-primary)',
        }}
      >
        {session.slug}
      </span>
      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          textTransform: 'uppercase',
          color: `var(${config.cssVar})`,
        }}
      >
        {config.label}
      </span>
      <span style={{ color: 'var(--fg-muted)' }}>
        {session.model && session.model.includes('opus')
          ? 'Opus'
          : session.model?.includes('sonnet')
            ? 'Sonnet'
            : session.model?.includes('haiku')
              ? 'Haiku'
              : ''}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--fg-muted)', fontSize: '11px' }}>
        Esc to collapse
      </span>
    </div>
  );
}
