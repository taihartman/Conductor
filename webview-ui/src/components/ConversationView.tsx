import React, { useRef, useEffect } from 'react';
import type { ConversationTurn } from '@shared/types';
import { CONVERSATION_ROLES } from '@shared/sharedConstants';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';
import { UserTurn } from './UserTurn';
import { AssistantTurn } from './AssistantTurn';
import { SystemTurn } from './SystemTurn';

interface ConversationViewProps {
  conversation: ConversationTurn[];
  /** Total number of continuation segments (continuationCount + 1), if applicable. */
  continuationTotal?: number;
}

export function ConversationView({ conversation, continuationTotal }: ConversationViewProps): React.ReactElement {
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
          conversation.map((turn, index) => {
            const elements: React.ReactElement[] = [];

            // Insert continuation segment divider when the segment index changes
            if (
              continuationTotal != null &&
              continuationTotal > 1 &&
              turn.continuationSegmentIndex != null &&
              turn.continuationSegmentIndex > 0
            ) {
              const prevTurn = index > 0 ? conversation[index - 1] : undefined;
              const prevSegment = prevTurn?.continuationSegmentIndex;
              if (prevSegment == null || prevSegment !== turn.continuationSegmentIndex) {
                const label = UI_STRINGS.CONTINUATION_DIVIDER
                  .replace('{n}', String(turn.continuationSegmentIndex + 1))
                  .replace('{total}', String(continuationTotal));
                elements.push(
                  <div
                    key={`cont-divider-${turn.continuationSegmentIndex}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px', // inline-ok
                      margin: '4px 0', // inline-ok
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: '1px',
                        backgroundColor: COLORS.CONTINUATION_DIVIDER_BORDER,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '10px', // inline-ok
                        fontWeight: 600,
                        color: COLORS.CONTINUATION_DIVIDER_TEXT,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: '1px',
                        backgroundColor: COLORS.CONTINUATION_DIVIDER_BORDER,
                      }}
                    />
                  </div>
                );
              }
            }

            switch (turn.role) {
              case CONVERSATION_ROLES.USER:
                elements.push(<UserTurn key={turn.id} turn={turn} />);
                break;
              case CONVERSATION_ROLES.ASSISTANT:
                elements.push(<AssistantTurn key={turn.id} turn={turn} />);
                break;
              case CONVERSATION_ROLES.SYSTEM:
                elements.push(<SystemTurn key={turn.id} turn={turn} />);
                break;
            }

            return elements;
          })
        )}
      </div>
    </div>
  );
}
