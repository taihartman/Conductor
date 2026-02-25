import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolStatsPanel(): React.ReactElement {
  const toolStats = useDashboardStore((s) => s.toolStats);
  const maxCount = Math.max(1, ...toolStats.map((s) => s.callCount));

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: 'var(--spacing-sm) var(--spacing-md)',
          borderBottom: '1px solid var(--border)',
          fontWeight: 600,
          fontSize: '13px',
        }}
      >
        Tool Usage
      </div>

      <div style={{ padding: 'var(--spacing-sm)' }}>
        {toolStats.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-md)',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: '12px',
            }}
          >
            No tool calls recorded
          </div>
        ) : (
          toolStats.slice(0, 15).map((stat) => (
            <div
              key={stat.toolName}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-sm)',
                padding: '3px var(--spacing-xs)',
                fontSize: '12px',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  minWidth: '90px',
                  maxWidth: '90px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--fg-primary)',
                  fontSize: '11px',
                }}
                title={stat.toolName}
              >
                {stat.toolName}
              </span>

              <div
                style={{
                  flex: 1,
                  height: '14px',
                  backgroundColor: 'var(--bg-primary)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(stat.callCount / maxCount) * 100}%`,
                    backgroundColor:
                      stat.errorCount > 0
                        ? 'rgba(220, 53, 69, 0.6)'
                        : 'rgba(0, 122, 204, 0.5)',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease',
                    minWidth: '2px',
                  }}
                />
              </div>

              <span
                style={{
                  minWidth: '30px',
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--fg-secondary)',
                }}
              >
                {stat.callCount}
              </span>

              <span
                style={{
                  minWidth: '45px',
                  textAlign: 'right',
                  fontSize: '10px',
                  color: 'var(--fg-muted)',
                }}
                title={`Avg: ${formatDuration(stat.avgDurationMs)}`}
              >
                {formatDuration(stat.avgDurationMs)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
