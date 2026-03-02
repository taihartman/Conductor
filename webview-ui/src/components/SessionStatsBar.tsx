import React from 'react';
import type { SessionInfo } from '@shared/types';
import { StatusDot } from './StatusDot';
import { STATUS_CONFIG } from '../config/statusConfig';
import { UI_STRINGS } from '../config/strings';
import {
  formatModel,
  formatTokens,
  formatCostCompact,
  getSessionDisplayName,
} from '../utils/formatters';

interface SessionStatsBarProps {
  session: SessionInfo;
  cost: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleAnalytics?: () => void;
  analyticsOpen?: boolean;
  isTerminalMode?: boolean;
  isAdopting?: boolean;
  /** True when adoption is permanently blocked (e.g. nested Claude session). */
  isAdoptDisabled?: boolean;
  onToggleView?: () => void;
  /** Called when the user clicks the force-kill terminal button. Only rendered in terminal mode. */
  onKillTerminal?: () => void;
}

export function SessionStatsBar({
  session,
  cost,
  isExpanded,
  onToggleExpand,
  onToggleAnalytics,
  analyticsOpen,
  isTerminalMode,
  isAdopting,
  isAdoptDisabled,
  onToggleView,
  onKillTerminal,
}: SessionStatsBarProps): React.ReactElement {
  const config = STATUS_CONFIG[session.status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-md)',
        padding: '6px var(--spacing-md)',
        height: '40px', // inline-ok
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        fontSize: '12px', // inline-ok
      }}
    >
      <StatusDot status={session.status} size={8} />

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
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
          letterSpacing: '0.5px',
          color: `var(${config.cssVar})`,
        }}
      >
        {config.label}
      </span>

      {session.model && (
        <span style={{ color: 'var(--fg-secondary)' }} title={session.model}>
          {formatModel(session.model)}
        </span>
      )}

      {session.gitBranch && (
        <span
          style={{
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px', // inline-ok
            maxWidth: '120px', // inline-ok
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={session.gitBranch}
        >
          {session.gitBranch}
        </span>
      )}

      <span style={{ color: 'var(--fg-muted)' }}>{session.turnCount} turns</span>

      <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' /* inline-ok */ }}>
        {formatTokens(session.totalInputTokens + session.totalOutputTokens)} tokens
      </span>

      {cost > 0 && (
        <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' /* inline-ok */ }}>
          {formatCostCompact(cost)}
        </span>
      )}

      <span style={{ flex: 1 }} />

      {onToggleView && (
        <button
          onClick={onToggleView}
          disabled={isAdopting || isAdoptDisabled}
          title={isAdoptDisabled ? UI_STRINGS.NESTED_SESSION_TOOLTIP : UI_STRINGS.TERMINAL_TOGGLE_TOOLTIP}
          style={{
            padding: '2px 6px',
            fontSize: '11px', // inline-ok
            borderRadius: '3px',
            border: `1px solid ${isTerminalMode ? 'var(--accent)' : 'var(--border)'}`,
            backgroundColor: isTerminalMode ? 'var(--accent, #007acc)' : 'var(--bg-card)', // inline-ok
            color: isTerminalMode ? '#fff' : 'var(--fg-secondary)', // inline-ok: button text
            cursor: isAdopting ? 'wait' : isAdoptDisabled ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1,
            opacity: isAdopting || isAdoptDisabled ? 0.5 : 1, // inline-ok: disabled state
          }}
        >
          {isAdopting
            ? UI_STRINGS.CHAT_INPUT_ADOPTING
            : isTerminalMode
              ? UI_STRINGS.CONVERSATION_VIEW_TOGGLE
              : UI_STRINGS.TERMINAL_VIEW_TOGGLE}
        </button>
      )}

      {isTerminalMode && onKillTerminal && (
        <button
          onClick={onKillTerminal}
          title={UI_STRINGS.TERMINAL_FORCE_KILL_TOOLTIP}
          style={{
            padding: '2px 6px',
            fontSize: '14px', // inline-ok
            borderRadius: '3px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--fg-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1,
          }}
        >
          {UI_STRINGS.TERMINAL_FORCE_KILL}
        </button>
      )}

      {onToggleAnalytics && (
        <button
          onClick={onToggleAnalytics}
          style={{
            padding: '2px 6px',
            fontSize: '14px', // inline-ok
            borderRadius: '3px',
            border: `1px solid ${analyticsOpen ? 'var(--accent)' : 'var(--border)'}`,
            backgroundColor: analyticsOpen ? 'rgba(0, 122, 204, 0.1)' : 'var(--bg-card)', // inline-ok
            color: analyticsOpen ? 'var(--accent)' : 'var(--fg-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1,
          }}
          title={UI_STRINGS.ANALYTICS_DRAWER_TOGGLE}
        >
          {'\u2261'}
        </button>
      )}

      <button
        onClick={onToggleExpand}
        style={{
          padding: '2px 6px',
          fontSize: '14px', // inline-ok
          borderRadius: '3px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--fg-secondary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          lineHeight: 1,
        }}
        title={isExpanded ? 'Collapse (Esc)' : 'Expand'}
      >
        {isExpanded ? '\u2199' : '\u2197'}
      </button>
    </div>
  );
}
