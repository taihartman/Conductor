import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import type { ExtensionToWebviewMessage } from '@shared/protocol';

export function useVsCodeMessage(): void {
  const {
    setFullState,
    setActivities,
    setConversation,
    setInputStatus,
    appendPtyBuffer,
    setPendingLaunchSession,
  } = useDashboardStore();

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
        case 'user:input-status':
          setInputStatus(message);
          break;
        case 'pty:data':
          appendPtyBuffer(message.sessionId, message.data);
          break;
        case 'session:launch-status':
          if (message.status === 'launched' && message.sessionId) {
            setPendingLaunchSession(message.sessionId);
          } else if (message.status === 'error') {
            setPendingLaunchSession(null);
          }
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    setFullState,
    setActivities,
    setConversation,
    setInputStatus,
    appendPtyBuffer,
    setPendingLaunchSession,
  ]);
}
