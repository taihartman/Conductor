import React, { useRef, useEffect } from 'react';
import type { ActivityEvent } from '@shared/types';
import { LiveFeedItem } from './LiveFeedItem';
import { UI_STRINGS } from '../config/strings';

interface LiveFeedProps {
  activities: ActivityEvent[];
}

export function LiveFeed({ activities }: LiveFeedProps): React.ReactElement {
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
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      shouldAutoScroll.current = isNearBottom;
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
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
            {UI_STRINGS.LIVE_FEED_EMPTY}
          </div>
        ) : (
          activities.map((event) => (
            <LiveFeedItem key={event.id} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
