import React from 'react';

export function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '300px',
        color: 'var(--fg-secondary)',
        textAlign: 'center',
        padding: 'var(--spacing-xl)',
      }}
    >
      <div style={{ fontSize: '48px', marginBottom: 'var(--spacing-lg)', opacity: 0.5 }}>
        {'{ }'}
      </div>
      <h2
        style={{
          color: 'var(--fg-primary)',
          fontSize: '18px',
          fontWeight: 600,
          marginBottom: 'var(--spacing-sm)',
        }}
      >
        No Active Sessions
      </h2>
      <p style={{ maxWidth: '400px', lineHeight: 1.6 }}>
        Start a Claude Code session in your terminal and the dashboard will
        automatically detect and display agent activity.
      </p>
      <p
        style={{
          marginTop: 'var(--spacing-md)',
          fontSize: '12px',
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Monitoring ~/.claude/projects/
      </p>
    </div>
  );
}
