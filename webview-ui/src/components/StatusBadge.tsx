import React from 'react';
import type { SessionStatus } from '../store/dashboardStore';

interface StatusBadgeProps {
  status: SessionStatus;
}

const STATUS_CONFIG: Record<
  SessionStatus,
  { label: string; color: string; bgColor: string }
> = {
  active: { label: 'Active', color: '#fff', bgColor: 'var(--badge-active)' },
  waiting: { label: 'Waiting', color: '#fff', bgColor: 'var(--badge-waiting)' },
  idle: { label: 'Idle', color: '#fff', bgColor: 'var(--badge-idle)' },
};

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 600,
        color: config.color,
        backgroundColor: config.bgColor,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: config.color,
          animation: status === 'active' ? 'pulse 1.5s infinite' : undefined,
        }}
      />
      {config.label}
    </span>
  );
}
