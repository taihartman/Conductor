import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import type { ExtensionToWebviewMessage } from '@shared/protocol';

export function useVsCodeMessage(): void {
  const { setFullState, setActivities, setConversation } = useDashboardStore();

  useEffect(() => {
    function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>): void {
      const message = event.data;

      switch (message.type) {
        case 'state:full':
          setFullState(
            message.sessions,
            message.activities,
            message.conversation,
            message.toolStats,
            message.tokenSummaries
          );
          break;
        case 'activity:full':
          setActivities(message.events);
          break;
        case 'conversation:full':
          setConversation(message.turns);
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setFullState, setActivities, setConversation]);
}
