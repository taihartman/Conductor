# Keyboard Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add spatial keyboard navigation (`Cmd+Shift+Arrows` / `Ctrl+Shift+Arrows`) to move between session cards on any board layout.

**Architecture:** VS Code keybindings fire commands registered in `extension.ts`, which forward IPC messages to the webview. A `useKeyboardNav` hook in the webview reads card positions from the DOM via `getBoundingClientRect()` and updates a `keyboardFocusedSessionId` in the Zustand store. Cards read focus state directly from the store.

**Tech Stack:** TypeScript, VS Code Extension API, React 19, Zustand 5, Vitest

**Design doc:** `docs/plans/2026-02-27-keyboard-navigation-design.md`

---

### Task 1: Shared Types — NavDirection

**Files:**
- Modify: `src/models/sharedConstants.ts` (append at end)
- Modify: `src/constants.ts:11-16` (extend COMMANDS object)

**Step 1: Add NavDirection to sharedConstants.ts**

Append to the end of `src/models/sharedConstants.ts`, before any final blank lines:

```typescript
// ---------------------------------------------------------------------------
// Spatial navigation directions
// ---------------------------------------------------------------------------

/** Spatial navigation directions for keyboard nav. */
export const NAV_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
} as const;

export type NavDirection = (typeof NAV_DIRECTIONS)[keyof typeof NAV_DIRECTIONS];
```

**Step 2: Add nav commands and context keys to constants.ts**

In `src/constants.ts`, extend the `COMMANDS` object (line 11-16) to add the 5 nav commands:

```typescript
export const COMMANDS = {
  OPEN: 'conductor.open',
  REFRESH: 'conductor.refresh',
  LAUNCH_SESSION: 'conductor.launchSession',
  QUICK_PICK_SESSION: 'conductor.quickPickSession',
  NAV_UP: 'conductor.navUp',
  NAV_DOWN: 'conductor.navDown',
  NAV_LEFT: 'conductor.navLeft',
  NAV_RIGHT: 'conductor.navRight',
  NAV_SELECT: 'conductor.navSelect',
} as const;
```

Add a new `CONTEXT_KEYS` object after the `COMMANDS` block:

```typescript
/** VS Code `when`-clause context keys managed by the extension. */
export const CONTEXT_KEYS = {
  PANEL_FOCUSED: 'conductor.panelFocused',
  KEYBOARD_NAV_ACTIVE: 'conductor.keyboardNavActive',
} as const;
```

Update the re-export block at the bottom of `constants.ts` to include `NAV_DIRECTIONS`:

```typescript
export {
  CONTENT_BLOCK_TYPES,
  RECORD_TYPES,
  SESSION_STATUSES,
  ACTIVITY_TYPES,
  CONVERSATION_ROLES,
  SYSTEM_EVENTS,
  STATUS_GROUPS,
  TOOL_APPROVAL_INPUTS,
  PLAN_INPUTS,
  LAUNCH_MODES,
  NAV_DIRECTIONS,
} from './models/sharedConstants';
export type { LaunchMode, NavDirection } from './models/sharedConstants';
```

**Step 3: Verify build**

Run: `npm run lint`
Expected: No type errors.

**Step 4: Commit**

```
feat: add NavDirection shared type and nav command constants
```

---

### Task 2: IPC Protocol — Nav Messages

**Files:**
- Modify: `src/models/protocol.ts:42-72` (ExtensionToWebviewMessage union)
- Modify: `src/models/protocol.ts:82-113` (WebviewToExtensionMessage union)

**Step 1: Add import for NavDirection**

In `src/models/protocol.ts` line 23, extend the import:

```typescript
import type { LaunchMode, NavDirection } from './sharedConstants';
```

**Step 2: Add nav messages to ExtensionToWebviewMessage**

Before the closing `;` of the `ExtensionToWebviewMessage` union (after the `history:full` line), add:

```typescript
  /** Extension-initiated spatial navigation (from Cmd+Shift+Arrow keybinding). */
  | { type: 'nav:move'; direction: NavDirection }
  /** Extension-initiated selection of the keyboard-focused card (from Enter keybinding). */
  | { type: 'nav:select' }
```

**Step 3: Add nav message to WebviewToExtensionMessage**

Before the closing `;` of the `WebviewToExtensionMessage` union (after the `history:resume` line), add:

```typescript
  /** Webview notifies extension when keyboard nav focus activates/deactivates (drives `when` clause). */
  | { type: 'nav:keyboard-focus-changed'; active: boolean }
```

**Step 4: Verify build**

Run: `npm run lint`
Expected: No type errors.

**Step 5: Commit**

```
feat: add nav:move, nav:select, and nav:keyboard-focus-changed IPC messages
```

---

### Task 3: Spatial Navigation Algorithm (Pure Functions + Tests)

**Files:**
- Create: `webview-ui/src/utils/spatialNav.ts`
- Create: `src/__tests__/spatialNav.test.ts`

**Step 1: Write tests for the spatial nav algorithm**

Create `src/__tests__/spatialNav.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findNearestCard, findWrapTarget, type CardPosition } from '../../webview-ui/src/utils/spatialNav';

/** Helper: create a CardPosition at (x, y) with a default 100x40 size. */
function card(sessionId: string, x: number, y: number, w = 100, h = 40): CardPosition {
  return {
    sessionId,
    rect: { x, y, width: w, height: h },
    center: { x: x + w / 2, y: y + h / 2 },
  };
}

describe('findNearestCard', () => {
  // Layout:
  //   A(0,0) B(120,0) C(240,0)
  //   D(0,60) E(120,60)
  const cards = [
    card('A', 0, 0),
    card('B', 120, 0),
    card('C', 240, 0),
    card('D', 0, 60),
    card('E', 120, 60),
  ];

  it('finds the card to the right', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'right', cards, 'A');
    expect(result?.sessionId).toBe('B');
  });

  it('finds the card to the left', () => {
    const result = findNearestCard({ x: 170, y: 20 }, 'left', cards, 'B');
    expect(result?.sessionId).toBe('A');
  });

  it('finds the card below', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'down', cards, 'A');
    expect(result?.sessionId).toBe('D');
  });

  it('finds the card above', () => {
    const result = findNearestCard({ x: 50, y: 80 }, 'up', cards, 'D');
    expect(result?.sessionId).toBe('A');
  });

  it('returns null when no card exists in that direction', () => {
    const result = findNearestCard({ x: 290, y: 20 }, 'right', cards, 'C');
    expect(result).toBeNull();
  });

  it('picks the card with smallest perpendicular distance', () => {
    // From anchor at A's center, going right — B is directly right, C is further
    const result = findNearestCard({ x: 50, y: 20 }, 'right', cards, 'A');
    expect(result?.sessionId).toBe('B');
  });

  it('excludes the current card from results', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'down', [card('A', 0, 0), card('A2', 0, 60)], 'A');
    expect(result?.sessionId).toBe('A2');
  });

  it('returns null for empty card list', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'right', [], null);
    expect(result).toBeNull();
  });

  it('returns the first card when currentSessionId is null', () => {
    const result = findNearestCard({ x: 50, y: 20 }, 'right', cards, null);
    expect(result?.sessionId).toBe('B');
  });
});

describe('findWrapTarget', () => {
  const cards = [
    card('A', 0, 0),
    card('B', 120, 0),
    card('C', 0, 60),
    card('D', 120, 60),
  ];

  it('wraps right to leftmost card in next row', () => {
    // At rightmost of top row, wrap right → leftmost of bottom row
    const result = findWrapTarget({ x: 170, y: 20 }, 'right', cards);
    expect(result?.sessionId).toBe('C');
  });

  it('wraps left to rightmost card in previous row', () => {
    // At leftmost of bottom row, wrap left → rightmost of top row
    const result = findWrapTarget({ x: 50, y: 80 }, 'left', cards);
    expect(result?.sessionId).toBe('B');
  });

  it('wraps down from bottom to top of next column', () => {
    // At bottom of left column, wrap down → top of right column
    const result = findWrapTarget({ x: 50, y: 80 }, 'down', cards);
    expect(result?.sessionId).toBe('B');
  });

  it('wraps up from top to bottom of previous column', () => {
    // At top of right column, wrap up → bottom of left column
    const result = findWrapTarget({ x: 170, y: 20 }, 'up', cards);
    expect(result?.sessionId).toBe('C');
  });

  it('wraps to first card when at absolute bottom-right going right', () => {
    const result = findWrapTarget({ x: 170, y: 80 }, 'right', cards);
    expect(result?.sessionId).toBe('A');
  });

  it('wraps to last card when at absolute top-left going left', () => {
    const result = findWrapTarget({ x: 50, y: 20 }, 'left', cards);
    expect(result?.sessionId).toBe('D');
  });

  it('returns null for empty card list', () => {
    const result = findWrapTarget({ x: 50, y: 20 }, 'right', []);
    expect(result).toBeNull();
  });

  it('returns the only card for single-card list', () => {
    const single = [card('only', 0, 0)];
    const result = findWrapTarget({ x: 50, y: 20 }, 'right', single);
    expect(result?.sessionId).toBe('only');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/spatialNav.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the spatial nav algorithm**

Create `webview-ui/src/utils/spatialNav.ts`:

```typescript
import type { NavDirection } from '@shared/sharedConstants';

export interface CardPosition {
  sessionId: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
}

/** Selector used to find session card elements in the DOM. */
const CARD_SELECTOR = '[data-session-id]';

// ── Pure functions (testable without DOM) ──────────────────────────

/**
 * Find the nearest card from an anchor point in the given direction.
 * Uses perpendicular distance as tiebreaker when multiple cards exist
 * in the same direction.
 *
 * @returns The nearest card, or null if none exists in that direction.
 */
export function findNearestCard(
  anchor: { x: number; y: number },
  direction: NavDirection,
  cards: CardPosition[],
  currentSessionId: string | null
): CardPosition | null {
  const candidates = cards.filter((c) => {
    if (c.sessionId === currentSessionId) return false;
    switch (direction) {
      case 'right': return c.center.x > anchor.x;
      case 'left':  return c.center.x < anchor.x;
      case 'down':  return c.center.y > anchor.y;
      case 'up':    return c.center.y < anchor.y;
    }
  });

  if (candidates.length === 0) return null;

  return candidates.reduce((best, c) => {
    const isHorizontal = direction === 'left' || direction === 'right';
    const primaryDist = isHorizontal
      ? Math.abs(c.center.x - anchor.x)
      : Math.abs(c.center.y - anchor.y);
    const perpDist = isHorizontal
      ? Math.abs(c.center.y - anchor.y)
      : Math.abs(c.center.x - anchor.x);

    const bestPrimary = isHorizontal
      ? Math.abs(best.center.x - anchor.x)
      : Math.abs(best.center.y - anchor.y);
    const bestPerp = isHorizontal
      ? Math.abs(best.center.y - anchor.y)
      : Math.abs(best.center.x - anchor.x);

    // Prefer smallest primary distance, then smallest perpendicular distance
    if (primaryDist < bestPrimary) return c;
    if (primaryDist === bestPrimary && perpDist < bestPerp) return c;
    return best;
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
 */
export function findWrapTarget(
  anchor: { x: number; y: number },
  direction: NavDirection,
  cards: CardPosition[]
): CardPosition | null {
  if (cards.length === 0) return null;

  // Sort cards into reading order: top-to-bottom, left-to-right
  const sorted = [...cards].sort((a, b) => {
    const rowThreshold = 20; // inline-ok: cards within 20px vertical are "same row"
    const rowDiff = a.center.y - b.center.y;
    if (Math.abs(rowDiff) > rowThreshold) return rowDiff;
    return a.center.x - b.center.x;
  });

  switch (direction) {
    case 'right': {
      // Find cards in next row (below anchor), pick leftmost
      const nextRow = sorted.filter((c) => c.center.y > anchor.y + 20); // inline-ok: row threshold
      if (nextRow.length > 0) return nextRow[0];
      return sorted[0]; // wrap to first card
    }
    case 'left': {
      // Find cards in previous row (above anchor), pick rightmost
      const prevRow = sorted.filter((c) => c.center.y < anchor.y - 20); // inline-ok: row threshold
      if (prevRow.length > 0) return prevRow[prevRow.length - 1];
      return sorted[sorted.length - 1]; // wrap to last card
    }
    case 'down': {
      // Find cards in next column (right of anchor), pick topmost
      const nextCol = sorted.filter((c) => c.center.x > anchor.x + 20); // inline-ok: column threshold
      if (nextCol.length > 0) return nextCol[0];
      return sorted[0]; // wrap to first card
    }
    case 'up': {
      // Find cards in previous column (left of anchor), pick bottommost
      const prevCol = sorted.filter((c) => c.center.x < anchor.x - 20); // inline-ok: column threshold
      if (prevCol.length > 0) return prevCol[prevCol.length - 1];
      return sorted[sorted.length - 1]; // wrap to last card
    }
  }
}

// ── DOM wrapper (runtime only, not unit-tested) ────────────────────

/**
 * Query all visible session card elements and return their positions.
 * Reads `data-session-id` attributes and `getBoundingClientRect()`.
 */
export function getCardPositions(): CardPosition[] {
  const elements = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  const positions: CardPosition[] = [];

  for (const el of elements) {
    const sessionId = el.getAttribute('data-session-id');
    if (!sessionId) continue;

    const domRect = el.getBoundingClientRect();
    if (domRect.width === 0 || domRect.height === 0) continue; // hidden element

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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/spatialNav.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```
feat: add spatial navigation algorithm with tests
```

---

### Task 4: Zustand Store — Keyboard Focus State

**Files:**
- Modify: `webview-ui/src/store/dashboardStore.ts`

**Step 1: Add keyboard focus state to DashboardState interface**

After line 82 (`overviewMode: OverviewMode;`), add:

```typescript
  /** Session ID highlighted by keyboard navigation (distinct from focusedSessionId). */
  keyboardFocusedSessionId: string | null;
  /** Spatial anchor (x, y) for directional navigation. */
  navAnchor: { x: number; y: number } | null;
```

After line 119 (`setOverviewMode: (mode: OverviewMode) => void;`), add:

```typescript
  setKeyboardFocus: (sessionId: string | null, anchor?: { x: number; y: number }) => void;
  clearKeyboardFocus: () => void;
```

**Step 2: Add initial state and actions to the create() call**

After line 151 (`overviewMode: OVERVIEW_MODES.LIST,`), add:

```typescript
  keyboardFocusedSessionId: null,
  navAnchor: null,
```

After line 265 (`setOverviewMode: (mode) => set({ overviewMode: mode }),`), add:

```typescript
  setKeyboardFocus: (sessionId, anchor) =>
    set((state) => ({
      keyboardFocusedSessionId: sessionId,
      ...(anchor ? { navAnchor: anchor } : {}),
    })),
  clearKeyboardFocus: () => set({ keyboardFocusedSessionId: null, navAnchor: null }),
```

**Step 3: Verify build**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```
feat: add keyboardFocusedSessionId and navAnchor to dashboard store
```

---

### Task 5: package.json — Commands & Keybindings

**Files:**
- Modify: `package.json:32-56` (commands and keybindings sections)

**Step 1: Add 5 nav commands to contributes.commands**

After the `conductor.quickPickSession` command entry (line 46-48), add:

```json
      {
        "command": "conductor.navUp",
        "title": "Conductor: Navigate Up"
      },
      {
        "command": "conductor.navDown",
        "title": "Conductor: Navigate Down"
      },
      {
        "command": "conductor.navLeft",
        "title": "Conductor: Navigate Left"
      },
      {
        "command": "conductor.navRight",
        "title": "Conductor: Navigate Right"
      },
      {
        "command": "conductor.navSelect",
        "title": "Conductor: Select Focused Session"
      }
```

**Step 2: Add 5 keybindings**

After the existing quickPickSession keybinding (line 50-55), add:

```json
      {
        "command": "conductor.navUp",
        "key": "ctrl+shift+up",
        "mac": "cmd+shift+up",
        "when": "conductor.panelFocused"
      },
      {
        "command": "conductor.navDown",
        "key": "ctrl+shift+down",
        "mac": "cmd+shift+down",
        "when": "conductor.panelFocused"
      },
      {
        "command": "conductor.navLeft",
        "key": "ctrl+shift+left",
        "mac": "cmd+shift+left",
        "when": "conductor.panelFocused"
      },
      {
        "command": "conductor.navRight",
        "key": "ctrl+shift+right",
        "mac": "cmd+shift+right",
        "when": "conductor.panelFocused"
      },
      {
        "command": "conductor.navSelect",
        "key": "enter",
        "when": "conductor.panelFocused && conductor.keyboardNavActive"
      }
```

**Step 3: Verify JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"`
Expected: "Valid JSON"

**Step 4: Commit**

```
feat: add nav keybindings to package.json
```

---

### Task 6: DashboardPanel — Public Methods, Focus Tracking, Context Keys

**Files:**
- Modify: `src/DashboardPanel.ts`

**Step 1: Add imports**

Add `CONTEXT_KEYS` to the imports from `./constants` (line 27-34):

```typescript
import {
  PANEL_TITLE,
  LOG_PREFIX,
  TIMING,
  PTY,
  SETTINGS,
  LAUNCH_MODES,
  WORKSPACE_STATE_KEYS,
  CONTEXT_KEYS,
} from './constants';
import type { LaunchMode, NavDirection } from './constants';
```

**Step 2: Add public navigate and selectKeyboardFocused methods**

After the `focusSession` method (line 264-270), add:

```typescript
  /**
   * Forward a spatial navigation command to the webview.
   * Called by nav commands registered in extension.ts.
   *
   * @param direction - The direction to navigate
   */
  public navigate(direction: NavDirection): void {
    this.postMessage({ type: 'nav:move', direction });
  }

  /**
   * Forward a nav-select command to the webview.
   * Called by the navSelect command registered in extension.ts.
   */
  public selectKeyboardFocused(): void {
    this.postMessage({ type: 'nav:select' });
  }
```

**Step 3: Add panel focus tracking in constructor**

After the `this.nameStore.onNamesChanged(...)` subscription (line 188), add:

```typescript
    // Track panel focus state for keybinding `when` clauses
    this.panel.onDidChangeViewState(
      (e) => {
        vscode.commands.executeCommand(
          'setContext',
          CONTEXT_KEYS.PANEL_FOCUSED,
          e.webviewPanel.active
        );
      },
      null,
      this.disposables
    );
```

**Step 4: Handle nav:keyboard-focus-changed in handleMessage**

Add a new case in the `handleMessage` switch (after the `history:resume` case, line 421):

```typescript
      case 'nav:keyboard-focus-changed':
        vscode.commands.executeCommand(
          'setContext',
          CONTEXT_KEYS.KEYBOARD_NAV_ACTIVE,
          message.active
        );
        break;
```

**Step 5: Clear context keys in dispose()**

In the `dispose()` method (line 1029-1037), before `DashboardPanel.currentPanel = undefined;`, add:

```typescript
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.PANEL_FOCUSED, false);
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.KEYBOARD_NAV_ACTIVE, false);
```

**Step 6: Verify build**

Run: `npm run lint`
Expected: No type errors.

**Step 7: Commit**

```
feat: add navigate/selectKeyboardFocused methods and panel focus tracking
```

---

### Task 7: extension.ts — Register Nav Commands

**Files:**
- Modify: `src/extension.ts:75-128`

**Step 1: Register 5 nav commands**

After the `quickPickCommand` registration (line 126) and before the `context.subscriptions.push(openCommand, ...)` line (line 128), add:

```typescript
  const navUpCommand = vscode.commands.registerCommand(COMMANDS.NAV_UP, () => {
    DashboardPanel.currentPanel?.navigate('up');
  });
  const navDownCommand = vscode.commands.registerCommand(COMMANDS.NAV_DOWN, () => {
    DashboardPanel.currentPanel?.navigate('down');
  });
  const navLeftCommand = vscode.commands.registerCommand(COMMANDS.NAV_LEFT, () => {
    DashboardPanel.currentPanel?.navigate('left');
  });
  const navRightCommand = vscode.commands.registerCommand(COMMANDS.NAV_RIGHT, () => {
    DashboardPanel.currentPanel?.navigate('right');
  });
  const navSelectCommand = vscode.commands.registerCommand(COMMANDS.NAV_SELECT, () => {
    DashboardPanel.currentPanel?.selectKeyboardFocused();
  });
```

Update the `context.subscriptions.push(...)` line to include the new commands:

```typescript
  context.subscriptions.push(
    openCommand,
    refreshCommand,
    launchCommand,
    quickPickCommand,
    navUpCommand,
    navDownCommand,
    navLeftCommand,
    navRightCommand,
    navSelectCommand
  );
```

**Step 2: Verify build**

Run: `npm run lint`
Expected: No type errors.

**Step 3: Commit**

```
feat: register nav commands in extension.ts
```

---

### Task 8: useKeyboardNav Hook

**Files:**
- Create: `webview-ui/src/hooks/useKeyboardNav.ts`

**Step 1: Create the hook**

Create `webview-ui/src/hooks/useKeyboardNav.ts`:

```typescript
import { useEffect, useCallback } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { getCardPositions, findNearestCard, findWrapTarget } from '../utils/spatialNav';
import { vscode } from '../vscode';
import type { NavDirection } from '@shared/sharedConstants';

/**
 * Keyboard navigation hook. Handles nav:move and nav:select IPC messages,
 * manages the navigation anchor, and clears focus on mouse clicks.
 *
 * Consumed by ConductorDashboard.
 */
export function useKeyboardNav(): {
  handleNavMove: (direction: NavDirection) => void;
  handleNavSelect: () => void;
} {
  const setKeyboardFocus = useDashboardStore((s) => s.setKeyboardFocus);
  const clearKeyboardFocus = useDashboardStore((s) => s.clearKeyboardFocus);
  const setFocusedSession = useDashboardStore((s) => s.setFocusedSession);

  const handleNavMove = useCallback(
    (direction: NavDirection) => {
      const { keyboardFocusedSessionId, navAnchor } = useDashboardStore.getState();
      const cards = getCardPositions();
      if (cards.length === 0) return;

      // First press with no focus — highlight the first card (top-left)
      if (!keyboardFocusedSessionId) {
        const sorted = [...cards].sort((a, b) => {
          const rowDiff = a.center.y - b.center.y;
          if (Math.abs(rowDiff) > 20) return rowDiff; // inline-ok: row threshold
          return a.center.x - b.center.x;
        });
        const first = sorted[0];
        setKeyboardFocus(first.sessionId, { x: first.center.x, y: first.center.y });
        vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: true });
        scrollCardIntoView(first.sessionId);
        return;
      }

      // Use anchor if available, otherwise fall back to the focused card's current position
      let anchor = navAnchor;
      if (!anchor) {
        const current = cards.find((c) => c.sessionId === keyboardFocusedSessionId);
        if (current) {
          anchor = { x: current.center.x, y: current.center.y };
        } else {
          // Focused card no longer exists — reset
          clearKeyboardFocus();
          vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: false });
          return;
        }
      }

      // Find nearest card in direction
      let target = findNearestCard(anchor, direction, cards, keyboardFocusedSessionId);
      if (!target) {
        target = findWrapTarget(anchor, direction, cards);
      }

      if (target && target.sessionId !== keyboardFocusedSessionId) {
        setKeyboardFocus(target.sessionId, { x: target.center.x, y: target.center.y });
        scrollCardIntoView(target.sessionId);
      }
    },
    [setKeyboardFocus, clearKeyboardFocus]
  );

  const handleNavSelect = useCallback(() => {
    const { keyboardFocusedSessionId } = useDashboardStore.getState();
    if (!keyboardFocusedSessionId) return;

    setFocusedSession(keyboardFocusedSessionId);
    vscode.postMessage({ type: 'session:focus', sessionId: keyboardFocusedSessionId });
    clearKeyboardFocus();
    vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: false });
  }, [setFocusedSession, clearKeyboardFocus]);

  // Clear keyboard focus on any mouse click
  useEffect(() => {
    function handleClick(): void {
      const { keyboardFocusedSessionId } = useDashboardStore.getState();
      if (keyboardFocusedSessionId) {
        clearKeyboardFocus();
        vscode.postMessage({ type: 'nav:keyboard-focus-changed', active: false });
      }
    }

    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [clearKeyboardFocus]);

  // Reset anchor on window resize (absolute coordinates become stale)
  useEffect(() => {
    function handleResize(): void {
      useDashboardStore.setState({ navAnchor: null });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { handleNavMove, handleNavSelect };
}

/** Scroll the card with the given session ID into view. */
function scrollCardIntoView(sessionId: string): void {
  const el = document.querySelector(`[data-session-id="${sessionId}"]`);
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
```

**Step 2: Verify build**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
feat: add useKeyboardNav hook for spatial navigation
```

---

### Task 9: Wire IPC Messages to Hook

**Files:**
- Modify: `webview-ui/src/hooks/useVsCodeMessage.ts`
- Modify: `webview-ui/src/components/ConductorDashboard.tsx`

**Step 1: Add nav message handlers to useVsCodeMessage**

The hook needs to receive `handleNavMove` and `handleNavSelect` as parameters. Update the hook signature:

Change line 5 from:
```typescript
export function useVsCodeMessage(): void {
```
to:
```typescript
export function useVsCodeMessage(navHandlers?: {
  handleNavMove: (direction: import('@shared/sharedConstants').NavDirection) => void;
  handleNavSelect: () => void;
}): void {
```

Add two cases in the switch statement (after the `history:full` case, line 78):

```typescript
        case 'nav:move':
          navHandlers?.handleNavMove(message.direction);
          break;
        case 'nav:select':
          navHandlers?.handleNavSelect();
          break;
```

Add `navHandlers` to the useEffect dependency array (line 84-99).

**Step 2: Wire useKeyboardNav into ConductorDashboard**

In `webview-ui/src/components/ConductorDashboard.tsx`, add the import (after line 14):

```typescript
import { useKeyboardNav } from '../hooks/useKeyboardNav';
```

Inside `ConductorDashboard()`, after the store selectors (around line 56), add:

```typescript
  const navHandlers = useKeyboardNav();
```

Find the `useVsCodeMessage()` call. It's consumed elsewhere — search for it. If it's called in the dashboard or in `App.tsx`, pass `navHandlers`:

```typescript
  useVsCodeMessage(navHandlers);
```

Note: If `useVsCodeMessage` is called in a different component (e.g., `App.tsx`), the hook import and wiring may need to happen there instead. Check where `useVsCodeMessage()` is called and wire accordingly.

**Step 3: Verify build**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```
feat: wire nav IPC messages to useKeyboardNav hook
```

---

### Task 10: Card Components — data-session-id + Focus Ring

**Files:**
- Modify: `webview-ui/src/components/KanbanCard.tsx`
- Modify: `webview-ui/src/components/OverviewCard.tsx`
- Modify: `webview-ui/src/config/colors.ts`

**Step 1: Add focus ring color to COLORS**

In `webview-ui/src/config/colors.ts`, add to the `COLORS` object (before the closing `} as const`):

```typescript
  /** Keyboard navigation focus ring */
  KEYBOARD_FOCUS_RING: 'var(--vscode-focusBorder, #007fd4)',
```

**Step 2: Add data-session-id and focus ring to KanbanCard**

In `webview-ui/src/components/KanbanCard.tsx`:

Add import for the store:
```typescript
import { useDashboardStore } from '../store/dashboardStore';
```

Inside the component function (after line 37 `const isActive = ...`), add:

```typescript
  const isKeyboardFocused = useDashboardStore(
    (s) => s.keyboardFocusedSessionId === session.sessionId
  );
```

Add `data-session-id` to the root `<div>` (line 63). Add the attribute right after the opening `<div`:

```tsx
    <div
      data-session-id={session.sessionId}
      onClick={onClick}
```

Add `boxShadow` to the style object for the focus ring. Update the style (around line 70-88) to add:

```typescript
        boxShadow: isKeyboardFocused ? `0 0 0 2px ${COLORS.KEYBOARD_FOCUS_RING}` : undefined,
```

**Step 3: Add focus ring to OverviewCard**

In `webview-ui/src/components/OverviewCard.tsx`:

Add import for the store:
```typescript
import { useDashboardStore } from '../store/dashboardStore';
```

Inside the component function (after line 49 `const isActive = ...`), add:

```typescript
  const isKeyboardFocused = useDashboardStore(
    (s) => s.keyboardFocusedSessionId === session.sessionId
  );
```

OverviewCard does NOT need `data-session-id` (its parent wrapper in OverviewPanel already provides it).

Add `boxShadow` to the root div's style object (around line 104-118):

```typescript
        boxShadow: isKeyboardFocused ? `0 0 0 2px ${COLORS.KEYBOARD_FOCUS_RING}` : undefined,
```

**Step 4: Verify build**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No type errors.

**Step 5: Commit**

```
feat: add keyboard focus ring to KanbanCard and OverviewCard
```

---

### Task 11: Help Text — Strings & SettingsDrawer

**Files:**
- Modify: `webview-ui/src/config/strings.ts`
- Modify: `webview-ui/src/components/SettingsDrawer.tsx`

**Step 1: Add nav shortcut strings**

In `webview-ui/src/config/strings.ts`, after line 172 (`HELP_SHORTCUT_EXPAND: 'Expand Detail View',`), add:

```typescript
  HELP_KEY_NAV_ARROWS: '{modifier}+Shift+Arrows',
  HELP_SHORTCUT_NAV_ARROWS: 'Navigate Between Sessions',
  HELP_KEY_NAV_SELECT: 'Enter',
  HELP_SHORTCUT_NAV_SELECT: 'Open Focused Session',
```

**Step 2: Add to SHORTCUTS array in SettingsDrawer**

In `webview-ui/src/components/SettingsDrawer.tsx`, add two entries to the `SHORTCUTS` array (after line 14, before `] as const`):

```typescript
  { key: UI_STRINGS.HELP_KEY_NAV_ARROWS, action: UI_STRINGS.HELP_SHORTCUT_NAV_ARROWS },
  { key: UI_STRINGS.HELP_KEY_NAV_SELECT, action: UI_STRINGS.HELP_SHORTCUT_NAV_SELECT },
```

**Step 3: Verify build**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```
feat: add keyboard nav shortcuts to help text
```

---

### Task 12: Full Build + Test Verification

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests pass, including the new `spatialNav.test.ts`.

**Step 2: Full build**

Run: `npm run build`
Expected: Both extension and webview build successfully.

**Step 3: Type check**

Run: `npm run lint`
Expected: No type errors.

**Step 4: Commit (if any fixes were needed)**

```
fix: resolve build/test issues from keyboard nav integration
```

---

### Task 13: Manual Integration Test

**Step 1: Launch extension**

Press F5 in VS Code to launch the Extension Development Host.

**Step 2: Open Conductor**

Run `Conductor: Open` from the command palette.

**Step 3: Test keyboard navigation**

- Press `Cmd+Shift+Down` — first card should highlight with a blue focus ring
- Press `Cmd+Shift+Down` again — focus moves to the card below
- Press `Cmd+Shift+Right` — focus moves to the card in the next column
- Press `Enter` — the focused card opens in the detail panel
- Press `Escape` — detail view collapses
- Click anywhere — focus ring disappears
- Switch to a different VS Code tab — `Cmd+Shift+Down` should NOT fire (panel not focused)

**Step 4: Test wrapping**

- Navigate to the bottom-right card
- Press `Cmd+Shift+Right` — should wrap to the first card
- Press `Cmd+Shift+Left` — should wrap to the last card

**Step 5: Test across layouts**

- Switch to Kanban board view — test all four directions
- Switch to list view — test Up/Down navigation
- Resize the panel — anchor should reset
