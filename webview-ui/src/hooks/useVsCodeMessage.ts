import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';

interface ExtensionMessage {
  type: string;
  sessions?: unknown[];
  events?: unknown[];
  stats?: unknown[];
  tokenSummaries?: unknown[];
  theme?: string;
}

export function useVsCodeMessage(): void {
  const {
    setSessions,
    setActivities,
    setToolStats,
    setTokenSummaries,
  } = useDashboardStore();

  useEffect(() => {
    function handleMessage(event: MessageEvent<ExtensionMessage>): void {
      const message = event.data;

      switch (message.type) {
        case 'sessions:update':
          if (message.sessions) {
            setSessions(message.sessions as ReturnType<typeof useDashboardStore.getState>['sessions']);
          }
          break;
        case 'activity:full':
          if (message.events) {
            setActivities(message.events as ReturnType<typeof useDashboardStore.getState>['activities']);
          }
          break;
        case 'toolStats:update':
          if (message.stats) {
            setToolStats(message.stats as ReturnType<typeof useDashboardStore.getState>['toolStats']);
          }
          break;
        case 'tokens:update':
          if (message.tokenSummaries) {
            setTokenSummaries(message.tokenSummaries as ReturnType<typeof useDashboardStore.getState>['tokenSummaries']);
          }
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setSessions, setActivities, setToolStats, setTokenSummaries]);
}
