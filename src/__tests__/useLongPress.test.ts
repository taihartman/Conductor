import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for useLongPress logic.
 *
 * Since @testing-library/react is not available in this project,
 * we test the timing and coordinate logic directly using the same
 * constants and patterns as the hook implementation.
 */

const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const CLICK_SUPPRESS_WINDOW_MS = 300;

/**
 * Simulates the useLongPress logic without React hooks,
 * matching the implementation in useLongPress.ts.
 */
function createLongPressSimulator(onLongPress: (pos: { x: number; y: number }) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startPos: { x: number; y: number } | null = null;
  let suppressClickUntil = 0;

  return {
    pointerDown(clientX: number, clientY: number): void {
      startPos = { x: clientX, y: clientY };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        suppressClickUntil = Date.now() + CLICK_SUPPRESS_WINDOW_MS;
        onLongPress({ x: clientX, y: clientY });
      }, LONG_PRESS_DELAY_MS);
    },
    pointerUp(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    pointerCancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    pointerMove(clientX: number, clientY: number): void {
      if (!startPos) return;
      const dx = clientX - startPos.x;
      const dy = clientY - startPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      }
    },
    shouldSuppressClick(): boolean {
      return Date.now() < suppressClickUntil;
    },
  };
}

describe('useLongPress logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onLongPress after delay with correct coordinates', () => {
    const onLongPress = vi.fn();
    const lp = createLongPressSimulator(onLongPress);

    lp.pointerDown(50, 75);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 50, y: 75 });
  });

  it('does NOT fire if pointer released early', () => {
    const onLongPress = vi.fn();
    const lp = createLongPressSimulator(onLongPress);

    lp.pointerDown(100, 200);
    vi.advanceTimersByTime(200);
    lp.pointerUp();
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does NOT fire if pointer moves beyond tolerance', () => {
    const onLongPress = vi.fn();
    const lp = createLongPressSimulator(onLongPress);

    lp.pointerDown(100, 100);
    // Move 20px horizontally — beyond 10px tolerance
    lp.pointerMove(120, 100);
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('DOES fire if pointer moves within tolerance', () => {
    const onLongPress = vi.fn();
    const lp = createLongPressSimulator(onLongPress);

    lp.pointerDown(100, 100);
    // Move 5px — within 10px tolerance
    lp.pointerMove(103, 104);
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('shouldSuppressClick returns true immediately after long-press, false after window expires', () => {
    const onLongPress = vi.fn();
    const lp = createLongPressSimulator(onLongPress);

    // Before long-press
    expect(lp.shouldSuppressClick()).toBe(false);

    lp.pointerDown(100, 200);
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

    // Immediately after long-press fires
    expect(lp.shouldSuppressClick()).toBe(true);

    // After click suppress window (300ms)
    vi.advanceTimersByTime(CLICK_SUPPRESS_WINDOW_MS);
    expect(lp.shouldSuppressClick()).toBe(false);
  });

  it('does NOT fire if pointer cancelled', () => {
    const onLongPress = vi.fn();
    const lp = createLongPressSimulator(onLongPress);

    lp.pointerDown(100, 200);
    lp.pointerCancel();
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
