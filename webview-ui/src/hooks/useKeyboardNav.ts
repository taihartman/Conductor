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

/** Timer for debouncing session:focus IPC during rapid keyboard navigation. */
let focusIpcTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce interval for session:focus IPC messages (ms). */
const FOCUS_IPC_DEBOUNCE_MS = 80; // inline-ok: navigation debounce

/**
 * Select a session: update store immediately for snappy UI,
 * debounce the IPC message to avoid wasted computation during rapid navigation.
 */
function selectSession(sessionId: string, setFocusedSession: (id: string) => void): void {
  setFocusedSession(sessionId);
  if (focusIpcTimer) clearTimeout(focusIpcTimer);
  focusIpcTimer = setTimeout(() => {
    vscode.postMessage({ type: 'session:focus', sessionId });
  }, FOCUS_IPC_DEBOUNCE_MS);
}

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
      if (cards.length === 0) {
        return;
      }

      // First press with no keyboard focus — start from the currently selected
      // session (if any), otherwise fall back to the top-left card in reading order.
      if (!keyboardFocusedSessionId) {
        const { focusedSessionId } = useDashboardStore.getState();
        const startCard = focusedSessionId
          ? cards.find((c) => c.sessionId === focusedSessionId)
          : null;

        const initial =
          startCard ??
          [...cards].sort((a, b) => {
            const rowDiff = a.center.y - b.center.y;
            if (Math.abs(rowDiff) > ROW_THRESHOLD) return rowDiff;
            return a.center.x - b.center.x;
          })[0];

        setKeyboardFocus(initial.sessionId, { x: initial.center.x, y: initial.center.y });
        selectSession(initial.sessionId, setFocusedSession);
        vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: true });
        scrollCardIntoView(initial.sessionId);
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
        selectSession(target.sessionId, setFocusedSession);
        scrollCardIntoView(target.sessionId);
      }
    },
    [setKeyboardFocus, clearKeyboardFocus, setFocusedSession]
  );

  const handleNavSelect = useCallback(() => {
    const { keyboardFocusedSessionId } = useDashboardStore.getState();
    if (!keyboardFocusedSessionId) return;

    selectSession(keyboardFocusedSessionId, setFocusedSession);
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
