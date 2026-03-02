import React, { useRef, useState, useCallback } from 'react';
import { COLORS } from '../config/colors';

interface DragState {
  sessionId: string;
  startX: number;
  startY: number;
  ghost: HTMLElement | null;
  active: boolean;
  pointerId: number;
  dropIndex: number;
}

export interface DragReorderResult {
  gridRef: React.RefObject<HTMLDivElement | null>;
  draggingSessionId: string | null;
  indicatorStyle: React.CSSProperties | null;
  handlePointerDown: (e: React.PointerEvent, sessionId: string) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handlePointerCancel: () => void;
}

const DRAG_THRESHOLD_PX = 5;

function makeIndicatorStyle(left: string, top: string, height: string): React.CSSProperties {
  return {
    position: 'absolute',
    left,
    top,
    width: '3px',
    height,
    borderRadius: '2px',
    backgroundColor: COLORS.DRAG_INDICATOR,
    boxShadow: `0 0 6px ${COLORS.DRAG_INDICATOR_GLOW}`,
    pointerEvents: 'none',
    zIndex: 100,
  };
}

export interface DragReorderOptions {
  /** Called when the pointer is released outside the overview grid. */
  onDropOutside?: (sessionId: string, clientX: number, clientY: number) => void;
  /** Called on every pointer move while dragging (for drop zone tracking). */
  onDragMove?: (clientX: number, clientY: number) => void;
  /** Called when the drag ends (cleanup drop zone highlighting). */
  onDragEnd?: () => void;
}

export function useDragReorder(
  sessionIds: string[],
  onReorder: (sessionIds: string[]) => void,
  options?: DragReorderOptions
): DragReorderResult {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties | null>(null);

  const getCardElements = useCallback((): HTMLElement[] => {
    if (!gridRef.current) return [];
    return Array.from(gridRef.current.querySelectorAll<HTMLElement>('[data-session-id]'));
  }, []);

  const computeDropIndex = useCallback(
    (clientX: number, clientY: number): number => {
      const cards = getCardElements();
      if (cards.length === 0) return 0;

      let closestIndex = 0;
      let closestDist = Infinity;

      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - centerX, clientY - centerY);

        if (dist < closestDist) {
          closestDist = dist;
          closestIndex = clientX > centerX ? i + 1 : i;
        }
      }

      return closestIndex;
    },
    [getCardElements]
  );

  const positionIndicator = useCallback(
    (dropIndex: number) => {
      const cards = getCardElements();
      const grid = gridRef.current;
      if (!grid || cards.length === 0) {
        setIndicatorStyle(null);
        return;
      }

      const gridRect = grid.getBoundingClientRect();

      if (dropIndex <= 0) {
        const first = cards[0].getBoundingClientRect();
        setIndicatorStyle(
          makeIndicatorStyle(
            `${first.left - gridRect.left - 2}px`,
            `${first.top - gridRect.top}px`,
            `${first.height}px`
          )
        );
      } else if (dropIndex >= cards.length) {
        const last = cards[cards.length - 1].getBoundingClientRect();
        setIndicatorStyle(
          makeIndicatorStyle(
            `${last.right - gridRect.left + 2}px`,
            `${last.top - gridRect.top}px`,
            `${last.height}px`
          )
        );
      } else {
        const prev = cards[dropIndex - 1].getBoundingClientRect();
        const next = cards[dropIndex].getBoundingClientRect();

        if (Math.abs(prev.top - next.top) < prev.height / 2) {
          const x = (prev.right + next.left) / 2 - gridRect.left;
          setIndicatorStyle(
            makeIndicatorStyle(`${x - 1}px`, `${prev.top - gridRect.top}px`, `${prev.height}px`)
          );
        } else {
          setIndicatorStyle(
            makeIndicatorStyle(
              `${next.left - gridRect.left - 2}px`,
              `${next.top - gridRect.top}px`,
              `${next.height}px`
            )
          );
        }
      }
    },
    [getCardElements]
  );

  const createGhost = useCallback(
    (sourceCard: HTMLElement, clientX: number, clientY: number): HTMLElement => {
      const ghost = sourceCard.cloneNode(true) as HTMLElement;
      const rect = sourceCard.getBoundingClientRect();
      ghost.style.position = 'fixed';
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${clientX - rect.width / 2}px`;
      ghost.style.top = `${clientY - rect.height / 2}px`;
      ghost.style.opacity = '0.85';
      ghost.style.transform = 'scale(1.03)';
      ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '10000';
      ghost.style.background = COLORS.DRAG_GHOST_BG;
      ghost.style.borderRadius = '6px';
      ghost.style.transition = 'none';
      document.body.appendChild(ghost);
      return ghost;
    },
    []
  );

  const cleanup = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.ghost) {
      drag.ghost.remove();
    }
    if (drag && gridRef.current) {
      gridRef.current.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
    setDraggingSessionId(null);
    setIndicatorStyle(null);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      sessionId,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      active: false,
      pointerId: e.pointerId,
      dropIndex: -1,
    };
    gridRef.current?.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (!drag.active) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

        drag.active = true;
        setDraggingSessionId(drag.sessionId);

        const sourceCard = gridRef.current?.querySelector<HTMLElement>(
          `[data-session-id="${drag.sessionId}"]`
        );
        if (sourceCard) {
          drag.ghost = createGhost(sourceCard, e.clientX, e.clientY);
        }
      }

      if (drag.ghost) {
        const rect = drag.ghost.getBoundingClientRect();
        drag.ghost.style.left = `${e.clientX - rect.width / 2}px`;
        drag.ghost.style.top = `${e.clientY - rect.height / 2}px`;
      }

      const idx = computeDropIndex(e.clientX, e.clientY);
      drag.dropIndex = idx;
      positionIndicator(idx);

      optionsRef.current?.onDragMove?.(e.clientX, e.clientY);
    },
    [createGhost, computeDropIndex, positionIndicator]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.active) {
        // Check if pointer is outside the overview grid
        const gridRect = gridRef.current?.getBoundingClientRect();
        const isOutsideGrid =
          gridRect &&
          (e.clientX < gridRect.left ||
            e.clientX > gridRect.right ||
            e.clientY < gridRect.top ||
            e.clientY > gridRect.bottom);

        if (isOutsideGrid && optionsRef.current?.onDropOutside) {
          optionsRef.current.onDropOutside(drag.sessionId, e.clientX, e.clientY);
        } else if (drag.dropIndex >= 0) {
          const dragIdx = sessionIds.indexOf(drag.sessionId);
          if (dragIdx >= 0) {
            const newIds = [...sessionIds];
            newIds.splice(dragIdx, 1);
            const insertAt = drag.dropIndex > dragIdx ? drag.dropIndex - 1 : drag.dropIndex;
            newIds.splice(insertAt, 0, drag.sessionId);
            onReorder(newIds);
          }
        }
      }

      optionsRef.current?.onDragEnd?.();
      cleanup();
    },
    [sessionIds, onReorder, cleanup]
  );

  const handlePointerCancel = useCallback(() => {
    optionsRef.current?.onDragEnd?.();
    cleanup();
  }, [cleanup]);

  return {
    gridRef,
    draggingSessionId,
    indicatorStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}
