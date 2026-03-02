import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { UI_STRINGS } from '../config/strings';

export function EmptyState(): React.ReactElement {
  const monitoringScope = useDashboardStore((s) => s.monitoringScope);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '300px', /* inline-ok */
        color: 'var(--fg-secondary)',
        textAlign: 'center',
        padding: 'var(--spacing-xl)',
      }}
    >
      <div
        style={{ fontSize: '48px' /* inline-ok */, marginBottom: 'var(--spacing-lg)', opacity: 0.5 }}
      >
        {'{ }'}
      </div>
      <h2
        style={{
          color: 'var(--fg-primary)',
          fontSize: '18px', /* inline-ok */
          fontWeight: 600,
          marginBottom: 'var(--spacing-sm)',
        }}
      >
        {UI_STRINGS.EMPTY_STATE_HEADING}
      </h2>
      <p style={{ maxWidth: '400px' /* inline-ok */, lineHeight: 1.6 }}>
        {UI_STRINGS.EMPTY_STATE_DESCRIPTION}
      </p>
      <p
        style={{
          marginTop: 'var(--spacing-md)',
          fontSize: '12px', /* inline-ok */
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {monitoringScope}
      </p>
    </div>
  );
}
