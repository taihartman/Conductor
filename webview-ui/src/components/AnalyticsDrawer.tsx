import React from 'react';
import type { ToolStatEntry, TokenSummary } from '@shared/types';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';
import { ToolStatsPanelInline } from './ToolStatsPanelInline';
import { TokenUsagePanelInline } from './TokenUsagePanelInline';

interface AnalyticsDrawerProps {
  open: boolean;
  onClose: () => void;
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
}

export function AnalyticsDrawer({
  open,
  onClose,
  toolStats,
  tokenSummaries,
}: AnalyticsDrawerProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <div
      style={{
        width: '300px', // inline-ok
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        backgroundColor: COLORS.ANALYTICS_DRAWER_BG,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Drawer header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px var(--spacing-md)', // inline-ok
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '11px', // inline-ok
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--fg-secondary)',
          }}
        >
          {UI_STRINGS.ANALYTICS_DRAWER_TITLE}
        </span>
        <button
          onClick={onClose}
          style={{
            padding: '2px 6px', // inline-ok
            fontSize: '12px', // inline-ok
            borderRadius: '3px', // inline-ok
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--fg-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1,
          }}
          title="Close analytics" // inline-ok
        >
          {'\u2715'}
        </button>
      </div>

      {/* Drawer content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div style={{ padding: 'var(--spacing-sm)' }}>
          <ToolStatsPanelInline toolStats={toolStats} />
        </div>
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: 'var(--spacing-sm)',
          }}
        >
          <TokenUsagePanelInline tokenSummaries={tokenSummaries} />
        </div>
      </div>
    </div>
  );
}
