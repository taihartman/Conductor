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
 */
export function forceRelayout(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
}
