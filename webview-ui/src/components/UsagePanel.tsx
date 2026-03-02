import React, { useMemo } from 'react';
import type { SessionInfo, StatsCache, StatsDailyActivity } from '@shared/types';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';
import {
  formatTokens,
  formatNumber,
  formatDurationHuman,
  formatDateShort,
  formatDateLong,
  aggregateModelUsage,
} from '../utils/formatters';

/** Number of recent days shown in the daily trend chart. */
const DAILY_TREND_DAYS = 7;

interface UsagePanelProps {
  stats: StatsCache | null;
  sessions: SessionInfo[];
}

export function UsagePanel({ stats, sessions }: UsagePanelProps): React.ReactElement {
  if (!stats) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--fg-muted)',
          gap: 'var(--spacing-sm)',
        }}
      >
        <span style={{ fontSize: '14px' /* inline-ok */ }}>{UI_STRINGS.USAGE_EMPTY_TITLE}</span>
        <span style={{ fontSize: '12px' /* inline-ok */ }}>
          {UI_STRINGS.USAGE_EMPTY_DESCRIPTION}
        </span>
      </div>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10); // inline-ok: date format
  const cachedToday = stats.dailyActivity.find((d) => d.date === todayStr);

  // Compute live today stats from in-memory sessions
  const liveToday = useMemo(() => {
    const todaySessions = sessions.filter(
      (s) => !s.isSubAgent && !s.isArtifact && s.startedAt.startsWith(todayStr),
    );
    return {
      sessionCount: todaySessions.length,
      messageCount: todaySessions.reduce((sum, s) => sum + s.turnCount, 0),
      toolCallCount: todaySessions.reduce((sum, s) => sum + s.toolCallCount, 0),
    };
  }, [sessions, todayStr]);

  // Merge cached and live: take the max of each counter so we never regress
  const todayActivity = {
    sessionCount: Math.max(cachedToday?.sessionCount ?? 0, liveToday.sessionCount),
    messageCount: Math.max(cachedToday?.messageCount ?? 0, liveToday.messageCount),
    toolCallCount: Math.max(cachedToday?.toolCallCount ?? 0, liveToday.toolCallCount),
  };

  // Build a complete 7-day range ending today, filling gaps with zero-activity entries
  const today = new Date(todayStr + 'T00:00:00Z');
  const completeDays = Array.from({ length: DAILY_TREND_DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAILY_TREND_DAYS - 1 - i));
    return d.toISOString().slice(0, 10); // inline-ok: date format
  });
  const activityMap = new Map(stats.dailyActivity.map((d) => [d.date, d]));
  const recentDays = completeDays.map((date) => {
    if (date === todayStr) {
      return { date, ...todayActivity };
    }
    return activityMap.get(date) ?? { date, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
  });

  return (
    <div
      style={{
        padding: 'var(--spacing-md)',
        overflow: 'auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-lg)',
      }}
    >
      {/* Last updated */}
      <span style={{ fontSize: '11px' /* inline-ok */, color: 'var(--fg-muted)' }}>
        {UI_STRINGS.USAGE_LABEL_LAST_UPDATED}: {formatDateLong(stats.lastComputedDate)}
      </span>

      {/* Today */}
      <section>
        <SectionHeading>{UI_STRINGS.USAGE_SECTION_TODAY}</SectionHeading>
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
          <StatCard label={UI_STRINGS.USAGE_LABEL_SESSIONS} value={todayActivity.sessionCount} />
          <StatCard label={UI_STRINGS.USAGE_LABEL_MESSAGES} value={todayActivity.messageCount} />
          <StatCard label={UI_STRINGS.USAGE_LABEL_TOOL_CALLS} value={todayActivity.toolCallCount} />
        </div>
      </section>

      {/* All Time */}
      <section>
        <SectionHeading>{UI_STRINGS.USAGE_SECTION_ALL_TIME}</SectionHeading>
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
          <StatCard label={UI_STRINGS.USAGE_LABEL_SESSIONS} value={stats.totalSessions} />
          <StatCard label={UI_STRINGS.USAGE_LABEL_MESSAGES} value={stats.totalMessages} />
          <StatCard label={UI_STRINGS.USAGE_LABEL_FIRST_SESSION} text={formatDateLong(stats.firstSessionDate)} />
          <StatCard
            label={UI_STRINGS.USAGE_LABEL_LONGEST_SESSION}
            text={stats.longestSession ? formatDurationHuman(stats.longestSession.duration) : '—'}
          />
        </div>
      </section>

      {/* Model Breakdown */}
      <section>
        <SectionHeading>{UI_STRINGS.USAGE_SECTION_MODEL_BREAKDOWN}</SectionHeading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' /* inline-ok */ }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr repeat(4, auto)',
              gap: 'var(--spacing-sm)',
              fontSize: '11px', // inline-ok
              color: 'var(--fg-muted)',
              padding: '0 var(--spacing-sm)',
            }}
          >
            <span>{UI_STRINGS.USAGE_LABEL_MODEL}</span>
            <span style={{ textAlign: 'right' }}>{UI_STRINGS.USAGE_LABEL_INPUT}</span>
            <span style={{ textAlign: 'right' }}>{UI_STRINGS.USAGE_LABEL_OUTPUT}</span>
            <span style={{ textAlign: 'right' }}>{UI_STRINGS.USAGE_LABEL_CACHE_READ}</span>
            <span style={{ textAlign: 'right' }}>{UI_STRINGS.USAGE_LABEL_CACHE_WRITE}</span>
          </div>
          {Object.entries(aggregateModelUsage(stats.modelUsage)).map(([displayName, usage]) => (
            <ModelRow key={displayName} model={displayName} usage={usage} />
          ))}
        </div>
      </section>

      {/* Daily Activity */}
      {recentDays.length > 0 && (
        <section>
          <SectionHeading>{UI_STRINGS.USAGE_SECTION_DAILY_ACTIVITY}</SectionHeading>
          <DailyTrendChart days={recentDays} todayStr={todayStr} />
        </section>
      )}

      {/* Peak Hours */}
      {Object.keys(stats.hourCounts).length > 0 && (
        <section>
          <SectionHeading>{UI_STRINGS.USAGE_SECTION_PEAK_HOURS}</SectionHeading>
          <HourChart hourCounts={stats.hourCounts} />
        </section>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3
      style={{
        fontSize: '12px', // inline-ok
        fontWeight: 600,
        color: 'var(--fg-secondary)',
        margin: '0 0 var(--spacing-sm) 0',
        paddingBottom: '4px', // inline-ok
        borderBottom: `1px solid ${COLORS.USAGE_SECTION_BORDER}`,
      }}
    >
      {children}
    </h3>
  );
}

function StatCard({
  label,
  value,
  text,
}: {
  label: string;
  value?: number;
  text?: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px', // inline-ok
        padding: '8px 12px', // inline-ok
        borderRadius: '4px', // inline-ok
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        minWidth: '100px', // inline-ok
      }}
    >
      <span style={{ fontSize: '11px' /* inline-ok */, color: 'var(--fg-muted)' }}>{label}</span>
      <span
        style={{
          fontSize: '16px', // inline-ok
          fontWeight: 600,
          color: 'var(--fg-primary)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {text ?? formatNumber(value ?? 0)}
      </span>
    </div>
  );
}

function ModelRow({
  model,
  usage,
}: {
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr repeat(4, auto)',
        gap: 'var(--spacing-sm)',
        fontSize: '12px', // inline-ok
        padding: '4px var(--spacing-sm)', // inline-ok
        borderRadius: '3px', // inline-ok
        color: 'var(--fg-primary)',
      }}
    >
      <span style={{ fontWeight: 500 }}>{model}</span>
      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {formatTokens(usage.inputTokens)}
      </span>
      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {formatTokens(usage.outputTokens)}
      </span>
      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {formatTokens(usage.cacheReadInputTokens)}
      </span>
      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {formatTokens(usage.cacheCreationInputTokens)}
      </span>
    </div>
  );
}

function DailyTrendChart({
  days,
  todayStr,
}: {
  days: StatsDailyActivity[];
  todayStr: string;
}): React.ReactElement {
  const maxMessages = Math.max(...days.map((d) => d.messageCount), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' /* inline-ok */ }}>
      {days.map((day) => {
        const pct = (day.messageCount / maxMessages) * 100;
        const isToday = day.date === todayStr;
        return (
          <div
            key={day.date}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-sm)',
            }}
          >
            <span
              style={{
                fontSize: '11px', // inline-ok
                color: 'var(--fg-muted)',
                width: '50px', // inline-ok
                flexShrink: 0,
                textAlign: 'right',
              }}
            >
              {formatDateShort(day.date)}
            </span>
            <div
              style={{
                flex: 1,
                height: '14px', // inline-ok
                borderRadius: '2px', // inline-ok
                backgroundColor: 'var(--bg-card)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: isToday ? COLORS.USAGE_BAR_TODAY : COLORS.USAGE_BAR_FILL,
                  borderRadius: '2px', // inline-ok
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span
              style={{
                fontSize: '11px', // inline-ok
                color: isToday ? 'var(--fg-primary)' : 'var(--fg-muted)',
                fontFamily: 'var(--font-mono)',
                width: '40px', // inline-ok
                textAlign: 'right',
                fontWeight: isToday ? 600 : 400,
              }}
            >
              {formatNumber(day.messageCount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HourChart({ hourCounts }: { hourCounts: Record<string, number> }): React.ReactElement {
  // Build all 24 hours, filling missing ones with 0
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourCounts[String(i)] ?? 0,
  }));
  const maxCount = Math.max(...hours.map((h) => h.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '0 var(--spacing-sm)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px', // inline-ok
          height: '60px', // inline-ok
        }}
      >
        {hours.map((h) => {
          const heightPct = (h.count / maxCount) * 100;
          return (
            <div
              key={h.hour}
              title={`${h.hour}:00 — ${formatNumber(h.count)} sessions`}
              style={{
                flex: 1,
                height: `${Math.max(heightPct, 2)}%`, // inline-ok: min 2% for visibility
                backgroundColor: h.count > 0 ? COLORS.USAGE_BAR_FILL : 'var(--bg-card)',
                borderRadius: '1px 1px 0 0', // inline-ok
                transition: 'height 0.3s ease',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '10px', // inline-ok
          color: 'var(--fg-secondary)',
          marginTop: '2px', // inline-ok
        }}
      >
        <span>{UI_STRINGS.USAGE_HOUR_MIDNIGHT}</span>
        <span>{UI_STRINGS.USAGE_HOUR_6AM}</span>
        <span>{UI_STRINGS.USAGE_HOUR_NOON}</span>
        <span>{UI_STRINGS.USAGE_HOUR_6PM}</span>
        <span>{UI_STRINGS.USAGE_HOUR_MIDNIGHT_END}</span>
      </div>
    </div>
  );
}
