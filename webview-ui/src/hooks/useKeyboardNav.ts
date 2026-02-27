/**
 * @module useKeyboardNav
 *
 * Keyboard navigation hook for spatial card navigation.
 * Handles nav:move and nav:select IPC messages from the extension,
 * manages the navigation anchor, and clears focus on mouse clicks.
 *
 * @remarks
 * Consumed by App.tsx — returns handlers that are passed to useVsCodeMessage.
 * The hook reads card positions from the DOM and updates the Zustand store.
 */

import { useEffect, useCallback } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { getCardPositions, findNearestCard, findWrapTarget } from '../utils/spatialNav';
import { vscode } from '../vscode';
import type { NavDirection } from '@shared/sharedConstants';

/** Row/column threshold for sorting cards into reading order (pixels). */
const ROW_THRESHOLD = 20; // inline-ok: layout grouping threshold

/** Return type for the useKeyboardNav hook. */
export interface KeyboardNavHandlers {
  handleNavMove: (direction: NavDirection) => void;
  handleNavSelect: () => void;
}

/**
 * Keyboard navigation hook. Handles nav:move and nav:select IPC messages,
 * manages the navigation anchor, and clears focus on mouse clicks.
 *
 * @returns Handlers for nav:move and nav:select messages, to be wired into useVsCodeMessage.
 */
export function useKeyboardNav(): KeyboardNavHandlers {
  const setKeyboardFocus = useDashboardStore((s) => s.setKeyboardFocus);
  const clearKeyboardFocus = useDashboardStore((s) => s.clearKeyboardFocus);
  const setFocusedSession = useDashboardStore((s) => s.setFocusedSession);

  const handleNavMove = useCallback(
    (direction: NavDirection) => {
      const { keyboardFocusedSessionId, navAnchor } = useDashboardStore.getState();
      const cards = getCardPositions();
      if (cards.length === 0) return;

      // First press with no focus — highlight the first card (top-left in reading order)
      if (!keyboardFocusedSessionId) {
        const sorted = [...cards].sort((a, b) => {
          const rowDiff = a.center.y - b.center.y;
          if (Math.abs(rowDiff) > ROW_THRESHOLD) return rowDiff;
          return a.center.x - b.center.x;
        });
        const first = sorted[0];
        setKeyboardFocus(first.sessionId, { x: first.center.x, y: first.center.y });
        vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: true });
        scrollCardIntoView(first.sessionId);
        return;
      }

      // Use anchor if available, otherwise fall back to the focused card's current position
      let anchor = navAnchor;
      if (!anchor) {
        const current = cards.find((c) => c.sessionId === keyboardFocusedSessionId);
        if (current) {
          anchor = { x: current.center.x, y: current.center.y };
        } else {
          // Focused card no longer exists in the DOM — reset
          clearKeyboardFocus();
          vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: false });
          return;
        }
      }

      // Find nearest card in the requested direction
      let target = findNearestCard(anchor, direction, cards, keyboardFocusedSessionId);
      if (!target) {
        target = findWrapTarget(anchor, direction, cards);
      }

      if (target && target.sessionId !== keyboardFocusedSessionId) {
        setKeyboardFocus(target.sessionId, { x: target.center.x, y: target.center.y });
        scrollCardIntoView(target.sessionId);
      }
    },
    [setKeyboardFocus, clearKeyboardFocus]
  );

  const handleNavSelect = useCallback(() => {
    const { keyboardFocusedSessionId } = useDashboardStore.getState();
    if (!keyboardFocusedSessionId) return;

    setFocusedSession(keyboardFocusedSessionId);
    vscode.postMessage({ type: 'session:focus', sessionId: keyboardFocusedSessionId });
    clearKeyboardFocus();
    vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: false });
  }, [setFocusedSession, clearKeyboardFocus]);

  // Clear keyboard focus on any mouse click
  useEffect(() => {
    function handleClick(): void {
      const { keyboardFocusedSessionId } = useDashboardStore.getState();
      if (keyboardFocusedSessionId) {
        clearKeyboardFocus();
        vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: false });
      }
    }

    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [clearKeyboardFocus]);

  // Reset anchor on window resize (absolute coordinates become stale)
  useEffect(() => {
    function handleResize(): void {
      useDashboardStore.setState({ navAnchor: null });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { handleNavMove, handleNavSelect };
}

/** Scroll the card with the given session ID into view. */
function scrollCardIntoView(sessionId: string): void {
  const el = document.querySelector(`[data-session-id="${sessionId}"]`);
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
