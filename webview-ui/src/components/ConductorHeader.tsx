import React, { useRef } from 'react';
import type { SessionInfo, TokenSummary } from '@shared/types';
import type { LaunchMode } from '@shared/sharedConstants';
import { SESSION_STATUSES, STATUS_GROUPS } from '@shared/sharedConstants';
import { LAYOUT_ORIENTATIONS } from '../store/dashboardStore';
import type { LayoutOrientation } from '../store/dashboardStore';
import { formatCost } from '../utils/formatters';
import { UI_STRINGS } from '../config/strings';
import { OwlblobMascot } from './OwlblobMascot';
import { SplitButton } from './SplitButton';

interface ConductorHeaderProps {
  sessions: SessionInfo[];
  tokenSummaries: TokenSummary[];
  onRefresh: () => void;
  onLaunchSession: (mode: LaunchMode) => void;
  onLaunchModeChange: (mode: LaunchMode) => void;
  launchMode: LaunchMode;
  nudgeActive: boolean;
  onMascotClick: () => void;
  mascotButtonRef?: React.Ref<HTMLButtonElement>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  layoutOrientation?: LayoutOrientation;
  onToggleOrientation?: () => void;
  showOrientationToggle?: boolean;
  activeTab?: 'sessions' | 'hidden';
  onTabChange?: (tab: 'sessions' | 'hidden') => void;
  hiddenCount?: number;
  isNestedSession?: boolean;
  onToggleSettings?: () => void;
}

export function ConductorHeader({
  sessions,
  tokenSummaries,
  onRefresh,
  onLaunchSession,
  onLaunchModeChange,
  launchMode,
  nudgeActive,
  onMascotClick,
  mascotButtonRef,
  searchQuery,
  onSearchChange,
  layoutOrientation,
  onToggleOrientation,
  showOrientationToggle,
  activeTab,
  onTabChange,
  hiddenCount,
  isNestedSession,
  onToggleSettings,
}: ConductorHeaderProps): React.ReactElement {
  // sessions already pre-filtered by ConductorDashboard (no sub-agents, optionally no artifacts)
  const workingCount = sessions.filter(
    (s) => STATUS_GROUPS.ACTIVE.has(s.status)
  ).length;
  const waitingCount = sessions.filter((s) => s.status === SESSION_STATUSES.WAITING).length;
  const errorCount = sessions.filter((s) => s.status === SESSION_STATUSES.ERROR).length;
  const totalCost = tokenSummaries.reduce((sum, t) => sum + t.estimatedCostUsd, 0);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px var(--spacing-md)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
        <button
          ref={mascotButtonRef}
          onClick={onMascotClick}
          aria-label={UI_STRINGS.ZEN_MASCOT_LABEL}
          title={UI_STRINGS.ZEN_MASCOT_TOOLTIP}
          className={`zen-mascot-btn${nudgeActive ? ' zen-nudge-active' : ''}`}
        >
          <OwlblobMascot size={40} />
        </button>
        <h1
          style={{
            fontSize: '14px', // inline-ok
            fontWeight: 700,
            color: 'var(--fg-primary)',
            margin: 0,
          }}
        >
          {UI_STRINGS.CONDUCTOR_HEADING}
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 'var(--spacing-md)',
            fontSize: '12px', // inline-ok
            color: 'var(--fg-secondary)',
          }}
        >
          {workingCount > 0 && (
            <span>
              <span style={{ color: 'var(--status-working)', fontWeight: 600 }}>
                {workingCount}
              </span>{' '}
              {UI_STRINGS.HEADER_STATUS_WORKING}
            </span>
          )}
          {waitingCount > 0 && (
            <span>
              <span style={{ color: 'var(--status-waiting)', fontWeight: 600 }}>
                {waitingCount}
              </span>{' '}
              {UI_STRINGS.HEADER_STATUS_AWAITING}
            </span>
          )}
          {errorCount > 0 && (
            <span>
              <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>
                {errorCount}
              </span>{' '}
              {UI_STRINGS.HEADER_STATUS_ERROR}
            </span>
          )}
          {totalCost > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: totalCost > 1 ? 'var(--status-waiting)' : 'var(--fg-muted)',
              }}
            >
              {formatCost(totalCost)} {UI_STRINGS.HEADER_COST_TOTAL}
            </span>
          )}
          {activeTab && onTabChange && (
            <div style={{ display: 'flex', gap: '2px', marginLeft: 'var(--spacing-md)' /* inline-ok */ }}>
              <TabButton active={activeTab === 'sessions'} onClick={() => onTabChange('sessions')}>
                {UI_STRINGS.TAB_SESSIONS}
              </TabButton>
              {(hiddenCount ?? 0) > 0 && (
                <TabButton active={activeTab === 'hidden'} onClick={() => onTabChange('hidden')}>
                  {UI_STRINGS.TAB_HIDDEN} ({hiddenCount})
                </TabButton>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
        <SplitButton
          currentMode={launchMode}
          onLaunch={onLaunchSession}
          onModeChange={onLaunchModeChange}
          disabled={isNestedSession}
        />
        <SearchInput query={searchQuery} onChange={onSearchChange} />
        {showOrientationToggle && onToggleOrientation && (
          <button
            onClick={onToggleOrientation}
            style={{
              padding: '3px 10px', // inline-ok
              fontSize: '11px', // inline-ok
              borderRadius: '3px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--fg-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title={UI_STRINGS.LAYOUT_TOGGLE_TOOLTIP}
            aria-label={UI_STRINGS.LAYOUT_TOGGLE_LABEL}
          >
            {layoutOrientation === LAYOUT_ORIENTATIONS.VERTICAL
              ? UI_STRINGS.LAYOUT_ICON_VERTICAL
              : UI_STRINGS.LAYOUT_ICON_HORIZONTAL}
          </button>
        )}
        <button
          onClick={onRefresh}
          style={{
            padding: '3px 10px', // inline-ok
            fontSize: '11px', // inline-ok
            borderRadius: '3px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--fg-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          title={UI_STRINGS.REFRESH_TITLE}
        >
          {UI_STRINGS.REFRESH_BUTTON}
        </button>
        {onToggleSettings && (
          <button
            onClick={onToggleSettings}
            style={{
              padding: '3px 10px', // inline-ok
              fontSize: '13px', // inline-ok
              borderRadius: '3px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--fg-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title={UI_STRINGS.SETTINGS_GEAR_TOOLTIP}
            aria-label={UI_STRINGS.SETTINGS_GEAR_TOOLTIP}
          >
            {'\u2699'}
          </button>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        fontSize: '12px', // inline-ok
        padding: '2px 8px', // inline-ok
        color: active ? 'var(--fg-primary)' : 'var(--fg-muted)',
        fontFamily: 'inherit',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function SearchInput({
  query,
  onChange,
}: {
  query: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('');
            inputRef.current?.blur();
            e.stopPropagation();
          }
        }}
        placeholder={UI_STRINGS.SEARCH_PLACEHOLDER}
        aria-label={UI_STRINGS.SEARCH_PLACEHOLDER}
        style={{
          width: '160px', // inline-ok
          padding: '3px 22px 3px 6px', // inline-ok
          fontSize: '11px', // inline-ok
          fontFamily: 'var(--font-mono)',
          borderRadius: '3px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--fg-primary)',
          outline: 'none',
        }}
      />
      {query && (
        <button
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          aria-label={UI_STRINGS.SEARCH_CLEAR}
          style={{
            position: 'absolute',
            right: '4px', // inline-ok
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: '12px', // inline-ok
            lineHeight: 1,
            padding: '0 2px', // inline-ok
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
