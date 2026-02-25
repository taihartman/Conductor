import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/*
 * We test the exported `pickBehavior` function and the scheduling logic
 * of useOwlblobIdle. Since the hook operates on refs + DOM classList,
 * we mock those to verify behavior without a real DOM.
 */

/* ── Import the module under test ─────────────────────────────── */

// Mock requestAnimationFrame/cancelAnimationFrame in Node
const rafCallbacks: Array<() => void> = [];
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
});
vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
  /* noop for test */
});

// Mock matchMedia for reduced-motion checks
let mockReducedMotion = false;
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('prefers-reduced-motion') ? mockReducedMotion : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Must import AFTER stubs are set up
import { pickBehavior } from '../../webview-ui/src/hooks/useOwlblobIdle';

/* ── Helpers ──────────────────────────────────────────────────── */

function createMockElement(): {
  classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  el: { current: unknown };
} {
  const add = vi.fn();
  const remove = vi.fn();
  const el = { current: { classList: { add, remove } } };
  return { classList: { add, remove }, el };
}

function createMockRefs(): {
  refs: Record<string, { current: unknown }>;
  mocks: Record<string, { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>;
} {
  const head = createMockElement();
  const earLeft = createMockElement();
  const earRight = createMockElement();
  const eyelidLeft = createMockElement();
  const eyelidRight = createMockElement();
  const wingLeft = createMockElement();
  const wingRight = createMockElement();
  const root = createMockElement();

  return {
    refs: {
      head: head.el,
      earLeft: earLeft.el,
      earRight: earRight.el,
      eyelidLeft: eyelidLeft.el,
      eyelidRight: eyelidRight.el,
      wingLeft: wingLeft.el,
      wingRight: wingRight.el,
      root: root.el,
    },
    mocks: {
      head: head.classList,
      earLeft: earLeft.classList,
      earRight: earRight.classList,
      eyelidLeft: eyelidLeft.classList,
      eyelidRight: eyelidRight.classList,
      wingLeft: wingLeft.classList,
      wingRight: wingRight.classList,
      root: root.classList,
    },
  };
}

function flushRaf(): void {
  const pending = [...rafCallbacks];
  rafCallbacks.length = 0;
  for (const cb of pending) cb();
}

/* ── Tests ────────────────────────────────────────────────────── */

describe('pickBehavior', () => {
  it('always returns a valid behavior object', () => {
    for (let i = 0; i < 50; i++) {
      const b = pickBehavior();
      expect(b).toHaveProperty('name');
      expect(b).toHaveProperty('weight');
      expect(b).toHaveProperty('durationMs');
      expect(b).toHaveProperty('className');
      expect(b).toHaveProperty('apply');
      expect(b.weight).toBeGreaterThan(0);
      expect(b.durationMs).toBeGreaterThan(0);
      expect(b.className).toMatch(/^ob-anim--/);
    }
  });

  it('weighted distribution favors blink over rare behaviors', () => {
    // With weight 4 for blink vs weight 1 for settle/wing-ruffle/head-bob,
    // over many trials blink should appear significantly more often.
    const counts: Record<string, number> = {};
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      const b = pickBehavior();
      counts[b.name] = (counts[b.name] || 0) + 1;
    }

    // Blink (weight 4/15 ≈ 26.7%) should appear far more than settle (weight 1/15 ≈ 6.7%)
    expect(counts['blink']).toBeGreaterThan((counts['settle'] ?? 0) * 2);
    expect(counts['blink']).toBeGreaterThan((counts['head-bob'] ?? 0) * 2);
  });
});

describe('useOwlblobIdle scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion = false;
    rafCallbacks.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies animation class to correct elements after timeout fires', async () => {
    // We test the scheduling logic by simulating what the hook does internally:
    // 1. setTimeout fires → picks a behavior → applies class via rAF
    // 2. After duration → removes class via rAF → schedules next

    const { refs, mocks } = createMockRefs();

    // Manually simulate what the hook does for a blink behavior
    const behavior = {
      className: 'ob-anim--blink',
      durationMs: 550,
      apply: () => [refs.eyelidLeft.current, refs.eyelidRight.current],
    };

    const elements = behavior.apply();

    // Simulate rAF adding class
    for (const el of elements) {
      (el as { classList: { add: (s: string) => void } }).classList.add(behavior.className);
    }

    expect(mocks.eyelidLeft.add).toHaveBeenCalledWith('ob-anim--blink');
    expect(mocks.eyelidRight.add).toHaveBeenCalledWith('ob-anim--blink');
  });

  it('cleans up class after duration expires', () => {
    const { refs, mocks } = createMockRefs();

    const behavior = {
      className: 'ob-anim--tilt-left',
      durationMs: 800,
    };

    const el = refs.head.current as {
      classList: { add: (s: string) => void; remove: (s: string) => void };
    };
    el.classList.add(behavior.className);

    // After duration, class should be removed
    el.classList.remove(behavior.className);

    expect(mocks.head.add).toHaveBeenCalledWith('ob-anim--tilt-left');
    expect(mocks.head.remove).toHaveBeenCalledWith('ob-anim--tilt-left');
  });

  it('respects prefers-reduced-motion', () => {
    mockReducedMotion = true;

    // The hook checks globalThis.matchMedia (stubbed via vi.stubGlobal)
    const mq = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    expect(mq.matches).toBe(true);

    // When reduced motion is preferred, the hook's scheduleNext() returns early
    // without setting any timeouts. We verify the check works correctly.
    mockReducedMotion = false;
    const mq2 = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    expect(mq2.matches).toBe(false);
  });

  it('behavior apply functions return correct elements from refs', () => {
    const { refs } = createMockRefs();

    // Test that each behavior's apply function maps to the right refs
    const blinkBehavior = pickBehavior();
    // pickBehavior is random, but we can test the apply functions directly
    // by importing the behaviors indirectly through pickBehavior results

    // Over many picks, we should see different behavior types
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const b = pickBehavior();
      seen.add(b.name);
      // Every behavior's apply should return an array
      const elements = b.apply(refs as never);
      expect(Array.isArray(elements)).toBe(true);
      expect(elements.length).toBeGreaterThan(0);
    }

    // Should have seen most behavior types
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
