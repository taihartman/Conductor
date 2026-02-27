import { describe, it, expect } from 'vitest';
import {
  findNearestCard,
  findWrapTarget,
  type CardPosition,
} from '../../webview-ui/src/utils/spatialNav';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default card dimensions for the test grid. */
const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 40;

/**
 * Create a CardPosition at (x, y) with an optional custom size.
 * Center is computed automatically from position and dimensions.
 */
function card(
  sessionId: string,
  x: number,
  y: number,
  w: number = DEFAULT_WIDTH,
  h: number = DEFAULT_HEIGHT
): CardPosition {
  return {
    sessionId,
    rect: { x, y, width: w, height: h },
    center: { x: x + w / 2, y: y + h / 2 },
  };
}

/**
 * Generate a grid of CardPositions for testing.
 * Cards are laid out in a rows x cols grid with configurable spacing.
 * Card IDs follow the pattern "R{row}C{col}" (e.g., "R0C0", "R1C2").
 *
 * @param rows - Number of rows
 * @param cols - Number of columns
 * @param xSpacing - Horizontal distance between card left edges
 * @param ySpacing - Vertical distance between card top edges
 * @returns Array of CardPositions arranged in the grid
 */
function makeGrid(
  rows: number,
  cols: number,
  xSpacing: number = 120,
  ySpacing: number = 60
): CardPosition[] {
  const result: CardPosition[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      result.push(card(`R${r}C${c}`, c * xSpacing, r * ySpacing));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// findNearestCard
// ---------------------------------------------------------------------------

describe('findNearestCard', () => {
  // Layout (5 cards):
  //   A(0,0) B(120,0) C(240,0)
  //   D(0,60) E(120,60)
  const cards = [
    card('A', 0, 0),
    card('B', 120, 0),
    card('C', 240, 0),
    card('D', 0, 60),
    card('E', 120, 60),
  ];

  it('finds the closest card to the right', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'right', cards, 'A');
    expect(result?.sessionId).toBe('B');
  });

  it('finds the closest card to the left', () => {
    const result = findNearestCard({ x: 170, y: 20 }, 'left', cards, 'B');
    expect(result?.sessionId).toBe('A');
  });

  it('finds the closest card below', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'down', cards, 'A');
    expect(result?.sessionId).toBe('D');
  });

  it('finds the closest card above', () => {
    const result = findNearestCard({ x: 50, y: 80 }, 'up', cards, 'D');
    expect(result?.sessionId).toBe('A');
  });

  it('returns null when no card exists in that direction', () => {
    const result = findNearestCard({ x: 290, y: 20 }, 'right', cards, 'C');
    expect(result).toBeNull();
  });

  it('prefers aligned cards over diagonal ones', () => {
    // From anchor at A's center, going right: B is directly right (same row),
    // E is diagonally right-down. B should win because it has smaller
    // perpendicular distance.
    const result = findNearestCard({ x: 50, y: 20 }, 'right', cards, 'A');
    expect(result?.sessionId).toBe('B');
  });

  it('excludes the current session from results', () => {
    const result = findNearestCard(
      { x: 50, y: 20 },
      'down',
      [card('A', 0, 0), card('A2', 0, 60)],
      'A'
    );
    expect(result?.sessionId).toBe('A2');
  });

  it('returns null for an empty card list', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'right', [], null);
    expect(result).toBeNull();
  });

  it('includes all cards when currentSessionId is null', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'right', cards, null);
    expect(result?.sessionId).toBe('B');
  });

  describe('with a larger grid', () => {
    // 3x3 grid:
    //   R0C0(0,0)   R0C1(120,0)   R0C2(240,0)
    //   R1C0(0,60)  R1C1(120,60)  R1C2(240,60)
    //   R2C0(0,120) R2C1(120,120) R2C2(240,120)
    const grid = makeGrid(3, 3);

    it('navigates right across a row', () => {
      const anchor = { x: 50, y: 20 }; // center of R0C0
      const result = findNearestCard(anchor, 'right', grid, 'R0C0');
      expect(result?.sessionId).toBe('R0C1');
    });

    it('navigates down across a column', () => {
      const anchor = { x: 50, y: 20 }; // center of R0C0
      const result = findNearestCard(anchor, 'down', grid, 'R0C0');
      expect(result?.sessionId).toBe('R1C0');
    });

    it('navigates left across a row', () => {
      const anchor = { x: 290, y: 20 }; // center of R0C2
      const result = findNearestCard(anchor, 'left', grid, 'R0C2');
      expect(result?.sessionId).toBe('R0C1');
    });

    it('navigates up across a column', () => {
      const anchor = { x: 50, y: 140 }; // center of R2C0
      const result = findNearestCard(anchor, 'up', grid, 'R2C0');
      expect(result?.sessionId).toBe('R1C0');
    });

    it('returns null at the rightmost edge of the last column', () => {
      const anchor = { x: 290, y: 20 }; // center of R0C2
      const result = findNearestCard(anchor, 'right', grid, 'R0C2');
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// findWrapTarget
// ---------------------------------------------------------------------------

describe('findWrapTarget', () => {
  // 2x2 grid:
  //   A(0,0)   B(120,0)
  //   C(0,60)  D(120,60)
  const cards = [card('A', 0, 0), card('B', 120, 0), card('C', 0, 60), card('D', 120, 60)];

  it('wraps right to leftmost card in next row', () => {
    // At rightmost of top row (B), wrap right -> leftmost of bottom row (C)
    const result = findWrapTarget({ x: 170, y: 20 }, 'right', cards);
    expect(result?.sessionId).toBe('C');
  });

  it('wraps left to rightmost card in previous row', () => {
    // At leftmost of bottom row (C), wrap left -> rightmost of top row (B)
    const result = findWrapTarget({ x: 50, y: 80 }, 'left', cards);
    expect(result?.sessionId).toBe('B');
  });

  it('wraps down from bottom to top of next column', () => {
    // At bottom of left column (C), wrap down -> top of right column (B)
    const result = findWrapTarget({ x: 50, y: 80 }, 'down', cards);
    expect(result?.sessionId).toBe('B');
  });

  it('wraps up from top to bottom of previous column', () => {
    // At top of right column (B), wrap up -> bottom of left column (C)
    const result = findWrapTarget({ x: 170, y: 20 }, 'up', cards);
    expect(result?.sessionId).toBe('C');
  });

  it('wraps from bottom-right to top-left when going right', () => {
    // At D (bottom-right), no cards below -> wraps to first card (A)
    const result = findWrapTarget({ x: 170, y: 80 }, 'right', cards);
    expect(result?.sessionId).toBe('A');
  });

  it('wraps from top-left to bottom-right when going left', () => {
    // At A (top-left), no cards above -> wraps to last card (D)
    const result = findWrapTarget({ x: 50, y: 20 }, 'left', cards);
    expect(result?.sessionId).toBe('D');
  });

  it('returns null for an empty card list', () => {
    const result = findWrapTarget({ x: 50, y: 20 }, 'right', []);
    expect(result).toBeNull();
  });

  it('returns the only card for a single-card list', () => {
    const single = [card('only', 0, 0)];
    const result = findWrapTarget({ x: 50, y: 20 }, 'right', single);
    expect(result?.sessionId).toBe('only');
  });

  describe('with a 3x3 grid', () => {
    const grid = makeGrid(3, 3);

    it('wraps right from end of first row to start of second row', () => {
      // At R0C2 (top-right), wrap right -> R1C0 (leftmost of second row)
      const result = findWrapTarget({ x: 290, y: 20 }, 'right', grid);
      expect(result?.sessionId).toBe('R1C0');
    });

    it('wraps left from start of last row to end of previous row', () => {
      // At R2C0 (bottom-left), wrap left -> R1C2 (rightmost of middle row)
      const result = findWrapTarget({ x: 50, y: 140 }, 'left', grid);
      expect(result?.sessionId).toBe('R1C2');
    });

    it('wraps down from bottom of last column to top of first', () => {
      // At R2C2 (bottom-right), no cards to the right -> wraps to R0C0
      const result = findWrapTarget({ x: 290, y: 140 }, 'down', grid);
      expect(result?.sessionId).toBe('R0C0');
    });

    it('wraps up from top of first column to bottom of last', () => {
      // At R0C0 (top-left), no cards to the left -> wraps to R2C2
      const result = findWrapTarget({ x: 50, y: 20 }, 'up', grid);
      expect(result?.sessionId).toBe('R2C2');
    });
  });
});
