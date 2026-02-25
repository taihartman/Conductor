import React, { useRef, useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { ActivityFeedItem } from './ActivityFeedItem';

export function ActivityFeed(): React.ReactElement {
  const activities = useDashboardStore((s) => s.activities);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && shouldAutoScroll.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activities]);

  function handleScroll(): void {
    const el = scrollRef.current;
    if (el) {
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      shouldAutoScroll.current = isNearBottom;
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
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
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Activity Feed</span>
        <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
          {activities.length} events
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {activities.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-xl)',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: '12px',
            }}
          >
            No activity yet...
          </div>
        ) : (
          activities.map((event) => (
            <ActivityFeedItem key={event.id} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
