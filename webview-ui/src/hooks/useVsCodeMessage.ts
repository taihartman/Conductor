import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import type { ExtensionToWebviewMessage } from '@shared/protocol';

export function useVsCodeMessage(): void {
  const {
    setSessions,
    setActivities,
    setToolStats,
    setTokenSummaries,
  } = useDashboardStore();

  useEffect(() => {
    function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>): void {
      const message = event.data;

      switch (message.type) {
        case 'sessions:update':
          setSessions(message.sessions);
          break;
        case 'activity:full':
          setActivities(message.events);
          break;
        case 'toolStats:update':
          setToolStats(message.stats);
          break;
        case 'tokens:update':
          setTokenSummaries(message.tokenSummaries);
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setSessions, setActivities, setToolStats, setTokenSummaries]);
}
