import { useRef, useCallback } from 'react';

const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const CLICK_SUPPRESS_WINDOW_MS = 300;

interface UseLongPressOptions {
  onLongPress: (position: { x: number; y: number }) => void;
}

interface UseLongPressResult {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerMove: (e: React.PointerEvent) => void;
  shouldSuppressClick: () => boolean;
}

export function useLongPress({ onLongPress }: UseLongPressOptions): UseLongPressResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      startPos.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_WINDOW_MS;
        onLongPress({ x: e.clientX, y: e.clientY });
      }, LONG_PRESS_DELAY_MS);
    },
    [onLongPress, clearTimer]
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const shouldSuppressClick = useCallback(() => {
    return Date.now() < suppressClickUntil.current;
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel, onPointerMove, shouldSuppressClick };
}
