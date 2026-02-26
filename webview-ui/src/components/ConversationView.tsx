import React, { useRef, useEffect } from 'react';
import type { ConversationTurn } from '@shared/types';
import { UI_STRINGS } from '../config/strings';
import { UserTurn } from './UserTurn';
import { AssistantTurn } from './AssistantTurn';
import { SystemTurn } from './SystemTurn';

interface ConversationViewProps {
  conversation: ConversationTurn[];
}

export function ConversationView({ conversation }: ConversationViewProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && shouldAutoScroll.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation]);

  function handleScroll(): void {
    const el = scrollRef.current;
    if (el) {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50; // inline-ok
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
        {conversation.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-xl)',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: '12px', // inline-ok
            }}
          >
            {UI_STRINGS.CONVERSATION_EMPTY}
          </div>
        ) : (
          conversation.map((turn) => {
            switch (turn.role) {
              case 'user':
                return <UserTurn key={turn.id} turn={turn} />;
              case 'assistant':
                return <AssistantTurn key={turn.id} turn={turn} />;
              case 'system':
                return <SystemTurn key={turn.id} turn={turn} />;
            }
          })
        )}
      </div>
    </div>
  );
}
