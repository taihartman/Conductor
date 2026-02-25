import React from 'react';
import type { ToolStatEntry } from '@shared/types';
import { formatDuration } from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';

interface ToolStatsPanelInlineProps {
  toolStats: ToolStatEntry[];
}

export function ToolStatsPanelInline({ toolStats }: ToolStatsPanelInlineProps): React.ReactElement {
  const maxCount = Math.max(1, ...toolStats.map((s) => s.callCount));

  if (toolStats.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-xl)',
          textAlign: 'center',
          color: 'var(--fg-muted)',
          fontSize: '12px',
        }}
      >
        {UI_STRINGS.TOOL_USAGE_EMPTY}
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--spacing-sm)', overflowY: 'auto' }}>
      {toolStats.slice(0, 20).map((stat) => (
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
              minWidth: '100px',
              maxWidth: '100px',
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
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(stat.callCount / maxCount) * 100}%`,
                backgroundColor:
                  stat.errorCount > 0 ? COLORS.ERROR_BAR : COLORS.NORMAL_BAR,
                borderRadius: '3px',
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

          {stat.errorCount > 0 && (
            <span
              style={{
                minWidth: '25px',
                textAlign: 'right',
                fontSize: '10px',
                color: 'var(--status-error)',
              }}
            >
              {stat.errorCount}err
            </span>
          )}

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
      ))}
    </div>
  );
}
