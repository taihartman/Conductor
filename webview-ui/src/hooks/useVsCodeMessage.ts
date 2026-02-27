import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import type { ExtensionToWebviewMessage } from '@shared/protocol';
import type { NavDirection } from '@shared/sharedConstants';

/** Optional handlers for keyboard navigation messages. */
export interface NavMessageHandlers {
  handleNavMove: (direction: NavDirection) => void;
  handleNavSelect: () => void;
}

export function useVsCodeMessage(navHandlers?: NavMessageHandlers): void {
  const {
    setFullState,
    setActivities,
    setConversation,
    setInputStatus,
    appendPtyBuffer,
    setPtyBuffers,
    setPendingLaunchSession,
    removePendingAdoption,
    setViewMode,
    setAutoHidePatterns,
    setFocusedSession,
    setLaunchMode,
    setHistoryEntries,
    setActiveTab,
    setUsageData,
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
            message.tokenSummaries,
            message.isNestedSession,
            message.focusedSessionId
          );
          break;
        case 'activity:full': {
          const { focusedSessionId } = useDashboardStore.getState();
          if (message.sessionId === focusedSessionId) {
            setActivities(message.events);
          }
          break;
        }
        case 'conversation:full': {
          const { focusedSessionId } = useDashboardStore.getState();
          if (message.sessionId === focusedSessionId) {
            setConversation(message.turns);
          }
          break;
        }
        case 'user:input-status':
          setInputStatus(message);
          break;
        case 'pty:data':
          appendPtyBuffer(message.sessionId, message.data);
          break;
        case 'pty:buffers':
          setPtyBuffers(message.buffers);
          break;
        case 'session:launch-status':
          if (message.status === 'launched' && message.sessionId) {
            setPendingLaunchSession(message.sessionId);
          } else if (message.status === 'error') {
            setPendingLaunchSession(null);
          }
          break;
        case 'session:adopt-status':
          removePendingAdoption(message.sessionId);
          if (message.status === 'adopted') {
            setViewMode(message.sessionId, 'terminal');
          }
          break;
        case 'settings:current':
          setAutoHidePatterns(message.autoHidePatterns);
          break;
        case 'launch-mode:current':
          setLaunchMode(message.mode);
          break;
        case 'session:focus-command':
          setFocusedSession(message.sessionId);
          setActiveTab('sessions');
          break;
        case 'history:full':
          setHistoryEntries(message.entries);
          break;
        case 'usage:full':
          setUsageData(message.stats);
          break;
        case 'nav:move':
          navHandlers?.handleNavMove(message.direction);
          break;
        case 'nav:select':
          navHandlers?.handleNavSelect();
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
    setPtyBuffers,
    setPendingLaunchSession,
    removePendingAdoption,
    setViewMode,
    setAutoHidePatterns,
    setFocusedSession,
    setLaunchMode,
    setHistoryEntries,
    setActiveTab,
    setUsageData,
    navHandlers,
  ]);
}
