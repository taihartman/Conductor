/**
 * Forces a full browser layout recalculation by dispatching a synthetic
 * window resize event. This triggers ResizeObserver callbacks in
 * xterm.js FitAddon, react-resizable-panels, and other layout-dependent
 * components — the same recalculation that occurs on a real window resize.
 *
 * @remarks
 * Used when the webview panel transitions from hidden to visible.
 * The `retainContextWhenHidden` setting keeps the DOM mounted while hidden,
 * but browser layout measurements go stale. A synthetic resize after one
 * animation frame gives the browser time to settle before recalculating.
 *
 * Debounced by 50ms to prevent layout thrash when multiple tiles trigger
 * resize events simultaneously (e.g., during tiling workspace splits).
 */

/** Debounce timer ID for forceRelayout. */
let relayoutTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce interval in milliseconds. */
const RELAYOUT_DEBOUNCE_MS = 50; // inline-ok: matches TILE_SIZING.RELAYOUT_DEBOUNCE_MS

export function forceRelayout(): void {
  if (relayoutTimer !== null) {
    clearTimeout(relayoutTimer);
  }
  relayoutTimer = setTimeout(() => {
    relayoutTimer = null;
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, RELAYOUT_DEBOUNCE_MS);
}
