/**
 * @module useDragToTile
 *
 * Position-based hit testing for drag-to-split interactions.
 * Since the overview grid uses setPointerCapture(), pointer events
 * are locked to the grid element — this module uses bounding rect
 * checks instead of DOM events to detect drop targets.
 */

import { useState, useCallback } from 'react';

/** Edge of a tile where the drop would occur. */
export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** Describes a potential drop target tile and which edge/center was hit. */
export interface DropTarget {
  tileId: string;
  edge: DropEdge;
}

/** Maps a DropEdge to the split direction it would create. */
export function edgeToDirection(edge: DropEdge): 'horizontal' | 'vertical' | null {
  switch (edge) {
    case 'left':
    case 'right':
      return 'horizontal';
    case 'top':
    case 'bottom':
      return 'vertical';
    case 'center':
      return null; // replace, no split
  }
}

/**
 * Find which tile (and which edge) the cursor is over.
 * Queries all elements with `[data-tile-id]` and checks bounding rects.
 */
export function findDropTarget(clientX: number, clientY: number): DropTarget | null {
  const tiles = document.querySelectorAll<HTMLElement>('[data-tile-id]');
  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;
    if (clientY < rect.top || clientY > rect.bottom) continue;

    const tileId = tile.getAttribute('data-tile-id');
    if (!tileId) continue;

    const edgeThreshold = Math.min(rect.width, rect.height) * 0.25; // inline-ok: matches TILE_SIZING.DROP_EDGE_THRESHOLD

    if (clientX - rect.left < edgeThreshold) return { tileId, edge: 'left' };
    if (rect.right - clientX < edgeThreshold) return { tileId, edge: 'right' };
    if (clientY - rect.top < edgeThreshold) return { tileId, edge: 'top' };
    if (rect.bottom - clientY < edgeThreshold) return { tileId, edge: 'bottom' };

    return { tileId, edge: 'center' };
  }
  return null;
}

export interface DragToTileState {
  /** Current drop target (updated on pointer move). */
  activeTarget: DropTarget | null;
  /** Update the active target based on cursor position. */
  updateTarget: (clientX: number, clientY: number) => void;
  /** Clear the active target. */
  clearTarget: () => void;
}

/**
 * Hook that tracks the current drop target during a drag operation.
 * Call `updateTarget` on pointer move, read `activeTarget` for visual feedback.
 */
export function useDragToTile(): DragToTileState {
  const [activeTarget, setActiveTarget] = useState<DropTarget | null>(null);

  const updateTarget = useCallback((clientX: number, clientY: number) => {
    setActiveTarget(findDropTarget(clientX, clientY));
  }, []);

  const clearTarget = useCallback(() => {
    setActiveTarget(null);
  }, []);

  return { activeTarget, updateTarget, clearTarget };
}
