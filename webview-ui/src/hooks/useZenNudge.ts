import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionInfo } from '@shared/types';

const ZEN_NUDGE_IDLE_THRESHOLD_MS = 45_000;
const ZEN_NUDGE_CHECK_INTERVAL_MS = 5_000;

interface ZenNudgeConfig {
  idleThresholdMs?: number;
  enabled?: boolean;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Pure function: determines whether the zen nudge should be active.
 * Exported for testability.
 */
export function shouldNudge(
  sessions: SessionInfo[],
  lastInteractionMs: number,
  thresholdMs: number,
  nowMs: number
): boolean {
  const parentSessions = sessions.filter((s) => !s.isSubAgent);
  const allBusy =
    parentSessions.length > 0 &&
    parentSessions.every((s) => s.status === 'working' || s.status === 'thinking');
  const idleLongEnough = nowMs - lastInteractionMs >= thresholdMs;
  return allBusy && idleLongEnough;
}

export function useZenNudge(sessions: SessionInfo[], config?: ZenNudgeConfig): boolean {
  const enabled = config?.enabled ?? true;
  const threshold = config?.idleThresholdMs ?? ZEN_NUDGE_IDLE_THRESHOLD_MS;
  const lastInteraction = useRef<number>(Date.now());
  const [nudgeActive, setNudgeActive] = useState(false);

  const resetIdle = useCallback(() => {
    lastInteraction.current = Date.now();
  }, []);

  // Track user interactions
  useEffect(() => {
    if (!enabled) return;

    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'scroll', 'pointermove'];

    for (const event of events) {
      window.addEventListener(event, resetIdle, { passive: true });
    }

    return () => {
      for (const event of events) {
        window.removeEventListener(event, resetIdle);
      }
    };
  }, [enabled, resetIdle]);

  // Check nudge condition periodically
  useEffect(() => {
    if (!enabled) {
      setNudgeActive(false);
      return;
    }

    const id = setInterval(() => {
      if (prefersReducedMotion()) {
        setNudgeActive(false);
        return;
      }

      setNudgeActive(shouldNudge(sessions, lastInteraction.current, threshold, Date.now()));
    }, ZEN_NUDGE_CHECK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [enabled, sessions, threshold]);

  return nudgeActive;
}
