import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionInfo } from '@shared/types';
import { STATUS_GROUPS } from '@shared/sharedConstants';

const ZEN_NUDGE_IDLE_THRESHOLD_MS = 45_000;
const ZEN_NUDGE_CHECK_INTERVAL_MS = 5_000;
const ZEN_AUTO_IDLE_THRESHOLD_MS = 300_000;
const ZEN_AUTO_COOLDOWN_MS = 300_000;

interface ZenNudgeConfig {
  idleThresholdMs?: number;
  enabled?: boolean;
  autoZenThresholdMs?: number;
  autoZenCooldownMs?: number;
  autoZenEnabled?: boolean;
}

export interface ZenNudgeResult {
  nudgeActive: boolean;
  autoZenTriggered: boolean;
  resetIdle: () => void;
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
  // sessions already pre-filtered by ConductorDashboard (no sub-agents, no hidden artifacts)
  const allBusy = sessions.length > 0 && sessions.every((s) => STATUS_GROUPS.ACTIVE.has(s.status));
  const idleLongEnough = nowMs - lastInteractionMs >= thresholdMs;
  return allBusy && idleLongEnough;
}

/**
 * Pure function: determines whether auto-zen should trigger.
 * Exported for testability.
 */
export function shouldAutoZen(
  lastInteractionMs: number,
  autoThresholdMs: number,
  zenExitedAt: number | null,
  cooldownMs: number,
  nowMs: number
): boolean {
  if (zenExitedAt !== null && nowMs - zenExitedAt < cooldownMs) {
    return false;
  }
  return nowMs - lastInteractionMs >= autoThresholdMs;
}

export function useZenNudge(
  sessions: SessionInfo[],
  zenExitedAt: number | null,
  config?: ZenNudgeConfig
): ZenNudgeResult {
  const enabled = config?.enabled ?? true;
  const threshold = config?.idleThresholdMs ?? ZEN_NUDGE_IDLE_THRESHOLD_MS;
  const autoZenThreshold = config?.autoZenThresholdMs ?? ZEN_AUTO_IDLE_THRESHOLD_MS;
  const autoZenCooldown = config?.autoZenCooldownMs ?? ZEN_AUTO_COOLDOWN_MS;
  const autoZenEnabled = config?.autoZenEnabled ?? true;
  const lastInteraction = useRef<number>(Date.now());
  const [nudgeActive, setNudgeActive] = useState(false);
  const [autoZenTriggered, setAutoZenTriggered] = useState(false);

  const resetIdle = useCallback(() => {
    lastInteraction.current = Date.now();
    setAutoZenTriggered(false);
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

  // Check nudge + auto-zen conditions periodically
  useEffect(() => {
    if (!enabled) {
      setNudgeActive(false);
      setAutoZenTriggered(false);
      return;
    }

    const id = setInterval(() => {
      if (prefersReducedMotion()) {
        setNudgeActive(false);
        setAutoZenTriggered(false);
        return;
      }

      const now = Date.now();
      setNudgeActive(shouldNudge(sessions, lastInteraction.current, threshold, now));

      if (autoZenEnabled) {
        setAutoZenTriggered(
          shouldAutoZen(
            lastInteraction.current,
            autoZenThreshold,
            zenExitedAt,
            autoZenCooldown,
            now
          )
        );
      } else {
        setAutoZenTriggered(false);
      }
    }, ZEN_NUDGE_CHECK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [
    enabled,
    sessions,
    threshold,
    autoZenEnabled,
    autoZenThreshold,
    autoZenCooldown,
    zenExitedAt,
  ]);

  return { nudgeActive, autoZenTriggered, resetIdle };
}
