import { useEffect, useRef, useCallback } from 'react';

/* ── Refs for animatable SVG parts ────────────────────────────── */

export interface OwlblobIdleRefs {
  head: React.RefObject<SVGGElement | null>;
  earLeft: React.RefObject<SVGGElement | null>;
  earRight: React.RefObject<SVGGElement | null>;
  eyelidLeft: React.RefObject<SVGPathElement | null>;
  eyelidRight: React.RefObject<SVGPathElement | null>;
  wingLeft: React.RefObject<SVGEllipseElement | null>;
  wingRight: React.RefObject<SVGEllipseElement | null>;
  root: React.RefObject<SVGGElement | null>;
  footLeft?: React.RefObject<SVGGElement | null>;
  footRight?: React.RefObject<SVGGElement | null>;
}

export interface OwlblobIdleConfig {
  minIntervalMs?: number;
  maxIntervalMs?: number;
  enabled?: boolean;
}

/* ── Timing constants ─────────────────────────────────────────── */

const OB_MIN_INTERVAL_MS = 4000;
const OB_MAX_INTERVAL_MS = 10000;
const OB_BLINK_DURATION_MS = 550;
const OB_TILT_DURATION_MS = 800;
const OB_EAR_TWITCH_DURATION_MS = 450;
const OB_SETTLE_DURATION_MS = 1200;
const OB_WING_RUFFLE_DURATION_MS = 650;
const OB_HEAD_BOB_DURATION_MS = 550;
const OB_TOE_WIGGLE_DURATION_MS = 600;
const OB_FOOT_TAP_DURATION_MS = 500;

/* ── Behavior definitions ─────────────────────────────────────── */

interface IdleBehavior {
  name: string;
  weight: number;
  durationMs: number;
  apply: (refs: OwlblobIdleRefs) => Element[];
  className: string;
}

const BEHAVIORS: IdleBehavior[] = [
  {
    name: 'blink',
    weight: 4,
    durationMs: OB_BLINK_DURATION_MS,
    className: 'ob-anim--blink',
    apply: (refs) =>
      [refs.eyelidLeft.current, refs.eyelidRight.current].filter(Boolean) as Element[],
  },
  {
    name: 'tilt-left',
    weight: 2,
    durationMs: OB_TILT_DURATION_MS,
    className: 'ob-anim--tilt-left',
    apply: (refs) => (refs.head.current ? [refs.head.current] : []),
  },
  {
    name: 'tilt-right',
    weight: 2,
    durationMs: OB_TILT_DURATION_MS,
    className: 'ob-anim--tilt-right',
    apply: (refs) => (refs.head.current ? [refs.head.current] : []),
  },
  {
    name: 'ear-twitch-left',
    weight: 2,
    durationMs: OB_EAR_TWITCH_DURATION_MS,
    className: 'ob-anim--ear-twitch',
    apply: (refs) => (refs.earLeft.current ? [refs.earLeft.current] : []),
  },
  {
    name: 'ear-twitch-right',
    weight: 2,
    durationMs: OB_EAR_TWITCH_DURATION_MS,
    className: 'ob-anim--ear-twitch',
    apply: (refs) => (refs.earRight.current ? [refs.earRight.current] : []),
  },
  {
    name: 'settle',
    weight: 1,
    durationMs: OB_SETTLE_DURATION_MS,
    className: 'ob-anim--settle',
    apply: (refs) => (refs.root.current ? [refs.root.current] : []),
  },
  {
    name: 'wing-ruffle',
    weight: 1,
    durationMs: OB_WING_RUFFLE_DURATION_MS,
    className: 'ob-anim--wing-ruffle',
    apply: (refs) => {
      const els: Element[] = [];
      if (refs.wingLeft.current) els.push(refs.wingLeft.current);
      if (refs.wingRight.current) els.push(refs.wingRight.current);
      return els;
    },
  },
  {
    name: 'head-bob',
    weight: 1,
    durationMs: OB_HEAD_BOB_DURATION_MS,
    className: 'ob-anim--head-bob',
    apply: (refs) => (refs.head.current ? [refs.head.current] : []),
  },
  {
    name: 'toe-wiggle',
    weight: 1,
    durationMs: OB_TOE_WIGGLE_DURATION_MS,
    className: 'ob-anim--toe-wiggle',
    apply: (refs) => {
      const els: Element[] = [];
      if (refs.footLeft?.current) els.push(refs.footLeft.current);
      if (refs.footRight?.current) els.push(refs.footRight.current);
      return els;
    },
  },
  {
    name: 'foot-tap',
    weight: 1,
    durationMs: OB_FOOT_TAP_DURATION_MS,
    className: 'ob-anim--foot-tap',
    apply: (refs) => {
      const candidates: Element[] = [];
      if (refs.footLeft?.current) candidates.push(refs.footLeft.current);
      if (refs.footRight?.current) candidates.push(refs.footRight.current);
      if (candidates.length === 0) return [];
      return [candidates[Math.floor(Math.random() * candidates.length)]];
    },
  },
];

/* ── Weighted random picker ───────────────────────────────────── */

const TOTAL_WEIGHT = BEHAVIORS.reduce((sum, b) => sum + b.weight, 0);

export function pickBehavior(): IdleBehavior {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const behavior of BEHAVIORS) {
    roll -= behavior.weight;
    if (roll <= 0) return behavior;
  }
  return BEHAVIORS[0];
}

/* ── Reduced-motion check ─────────────────────────────────────── */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ── The hook ─────────────────────────────────────────────────── */

export function useOwlblobIdle(refs: OwlblobIdleRefs, config: OwlblobIdleConfig = {}): void {
  const {
    minIntervalMs = OB_MIN_INTERVAL_MS,
    maxIntervalMs = OB_MAX_INTERVAL_MS,
    enabled = true,
  } = config;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const scheduleNext = useCallback(() => {
    if (prefersReducedMotion()) return;

    const delay = minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs);

    timeoutRef.current = setTimeout(() => {
      if (prefersReducedMotion()) {
        scheduleNext();
        return;
      }

      const behavior = pickBehavior();
      const elements = behavior.apply(refs);

      if (elements.length === 0) {
        scheduleNext();
        return;
      }

      rafRef.current = requestAnimationFrame(() => {
        for (const el of elements) {
          el.classList.add(behavior.className);
        }

        cleanupRef.current = setTimeout(() => {
          rafRef.current = requestAnimationFrame(() => {
            for (const el of elements) {
              el.classList.remove(behavior.className);
            }
          });
          scheduleNext();
        }, behavior.durationMs);
      });
    }, delay);
  }, [refs, minIntervalMs, maxIntervalMs]);

  useEffect(() => {
    if (!enabled) return;

    scheduleNext();

    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      if (cleanupRef.current !== null) clearTimeout(cleanupRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, scheduleNext]);
}
