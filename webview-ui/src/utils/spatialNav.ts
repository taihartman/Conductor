/**
 * @module spatialNav
 *
 * Pure spatial navigation algorithm for keyboard-driven card navigation.
 * Split into testable pure functions and a thin DOM wrapper.
 *
 * @remarks
 * The scoring formula uses Manhattan-style distance with a weighted
 * perpendicular component: `primaryDistance + 0.5 * perpendicularDistance`.
 * This ensures cards directly in line are preferred over diagonal ones.
 */

import type { NavDirection } from '@shared/sharedConstants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Position data for a session card, used by the spatial nav algorithm. */
export interface CardPosition {
  sessionId: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Selector used to find session card elements in the DOM. */
const CARD_SELECTOR = '[data-session-id]';

/**
 * Weight applied to perpendicular distance in the scoring formula.
 * A value of 0.5 means perpendicular distance counts half as much as
 * primary (directional) distance.
 */
const PERPENDICULAR_WEIGHT = 0.5; // inline-ok: algorithm tuning constant

/**
 * Vertical/horizontal threshold (in pixels) for grouping cards into
 * the same row or column during wrap calculations.
 */
const ROW_COL_THRESHOLD = 20; // inline-ok: layout grouping threshold

// ---------------------------------------------------------------------------
// Pure functions (testable without DOM)
// ---------------------------------------------------------------------------

/**
 * Find the nearest card from an anchor point in the given direction.
 * Uses a weighted Manhattan-style scoring formula:
 * `primaryDistance + 0.5 * perpendicularDistance`.
 *
 * @param anchor - The (x, y) point to navigate from
 * @param direction - The direction to search
 * @param cards - All visible card positions
 * @param currentSessionId - The currently focused session (excluded from results)
 * @returns The nearest card in the given direction, or null if none exists
 */
export function findNearestCard(
  anchor: { x: number; y: number },
  direction: NavDirection,
  cards: readonly CardPosition[],
  currentSessionId: string | null
): CardPosition | null {
  const candidates = cards.filter((c) => {
    if (c.sessionId === currentSessionId) return false;
    switch (direction) {
      case 'right':
        return c.center.x > anchor.x;
      case 'left':
        return c.center.x < anchor.x;
      case 'down':
        return c.center.y > anchor.y;
      case 'up':
        return c.center.y < anchor.y;
    }
  });

  if (candidates.length === 0) return null;

  const isHorizontal = direction === 'left' || direction === 'right';

  return candidates.reduce((best, c) => {
    const score = computeScore(anchor, c, isHorizontal);
    const bestScore = computeScore(anchor, best, isHorizontal);
    return score < bestScore ? c : best;
  });
}

/**
 * Find the wrap-around target when no card exists in the given direction.
 *
 * Wrapping logic (reading-order model):
 * - Right: leftmost card in the next row down (or first card if at bottom-right)
 * - Left: rightmost card in the previous row up (or last card if at top-left)
 * - Down: topmost card in the next column right (or first card if at bottom of last column)
 * - Up: bottommost card in the previous column left (or last card if at top of first column)
 *
 * @param anchor - The (x, y) point to wrap from
 * @param direction - The direction that triggered wrapping
 * @param cards - All visible card positions
 * @returns The wrap target card, or null if the card list is empty
 */
export function findWrapTarget(
  anchor: { x: number; y: number },
  direction: NavDirection,
  cards: readonly CardPosition[]
): CardPosition | null {
  if (cards.length === 0) return null;

  // Sort cards into reading order: top-to-bottom, left-to-right
  const sorted = [...cards].sort((a, b) => {
    const rowDiff = a.center.y - b.center.y;
    if (Math.abs(rowDiff) > ROW_COL_THRESHOLD) return rowDiff;
    return a.center.x - b.center.x;
  });

  switch (direction) {
    case 'right': {
      // Find cards in next row (below anchor), pick leftmost
      const nextRow = sorted.filter((c) => c.center.y > anchor.y + ROW_COL_THRESHOLD);
      if (nextRow.length > 0) return nextRow[0];
      return sorted[0]; // wrap to first card (top-left)
    }
    case 'left': {
      // Find cards in previous row (above anchor), pick rightmost
      const prevRow = sorted.filter((c) => c.center.y < anchor.y - ROW_COL_THRESHOLD);
      if (prevRow.length > 0) return prevRow[prevRow.length - 1];
      return sorted[sorted.length - 1]; // wrap to last card (bottom-right)
    }
    case 'down': {
      // Find cards in next column (right of anchor), pick topmost
      const nextCol = sorted.filter((c) => c.center.x > anchor.x + ROW_COL_THRESHOLD);
      if (nextCol.length > 0) return nextCol[0];
      return sorted[0]; // wrap to first card (top-left)
    }
    case 'up': {
      // Find cards in previous column (left of anchor), pick bottommost
      const prevCol = sorted.filter((c) => c.center.x < anchor.x - ROW_COL_THRESHOLD);
      if (prevCol.length > 0) return prevCol[prevCol.length - 1];
      return sorted[sorted.length - 1]; // wrap to last card (bottom-right)
    }
  }
}

// ---------------------------------------------------------------------------
// DOM wrapper (runtime only, not unit-tested)
// ---------------------------------------------------------------------------

/**
 * Query all visible session card elements and return their positions.
 * Reads `data-session-id` attributes and `getBoundingClientRect()`.
 *
 * @returns Array of card positions for all visible session cards
 */
export function getCardPositions(): CardPosition[] {
  const elements = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  const positions: CardPosition[] = [];

  for (const el of elements) {
    const sessionId = el.getAttribute('data-session-id');
    if (!sessionId) {
      continue;
    }

    const domRect = el.getBoundingClientRect();
    if (domRect.width === 0 || domRect.height === 0) {
      continue;
    }

    positions.push({
      sessionId,
      rect: { x: domRect.x, y: domRect.y, width: domRect.width, height: domRect.height },
      center: {
        x: domRect.x + domRect.width / 2,
        y: domRect.y + domRect.height / 2,
      },
    });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the weighted Manhattan-style score for a candidate card.
 * Lower score = better match.
 */
function computeScore(
  anchor: { x: number; y: number },
  card: CardPosition,
  isHorizontal: boolean
): number {
  const primaryDist = isHorizontal
    ? Math.abs(card.center.x - anchor.x)
    : Math.abs(card.center.y - anchor.y);
  const perpDist = isHorizontal
    ? Math.abs(card.center.y - anchor.y)
    : Math.abs(card.center.x - anchor.x);

  return primaryDist + PERPENDICULAR_WEIGHT * perpDist;
}
