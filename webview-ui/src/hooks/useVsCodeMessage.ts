import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import type { ExtensionToWebviewMessage } from '@shared/protocol';
import type { NavDirection } from '@shared/sharedConstants';
import { forceRelayout } from '../utils/layout';

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
    setOverviewMode,
    setKanbanSortOrders,
    setHistoryEntries,
    setActiveTab,
    setUsageData,
    setSavedTileLayouts,
    setSessionActivities,
    setSessionConversation,
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
            message.focusedSessionId,
            message.monitoringScope
          );
          break;
        case 'activity:full': {
          const state = useDashboardStore.getState();
          if (message.sessionId === state.focusedSessionId) {
            setActivities(message.events);
          }
          // Also store per-session data for tiled panels
          if (state.tileRoot && message.sessionId) {
            setSessionActivities(message.sessionId, message.events);
          }
          break;
        }
        case 'conversation:full': {
          const state = useDashboardStore.getState();
          if (message.sessionId === state.focusedSessionId) {
            setConversation(message.turns);
          }
          // Also store per-session data for tiled panels
          if (state.tileRoot && message.sessionId) {
            setSessionConversation(message.sessionId, message.turns);
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
        case 'overview-mode:current':
          setOverviewMode(message.mode);
          break;
        case 'kanban-sort-orders:current':
          setKanbanSortOrders(message.sortOrders);
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
        case 'tile-layouts:current':
          setSavedTileLayouts(message.layouts);
          break;
        case 'panel:visible':
          forceRelayout();
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
    setOverviewMode,
    setKanbanSortOrders,
    setHistoryEntries,
    setActiveTab,
    setUsageData,
    setSavedTileLayouts,
    setSessionActivities,
    setSessionConversation,
    navHandlers,
  ]);
}
