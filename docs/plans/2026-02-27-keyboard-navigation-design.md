# Keyboard Navigation for Session Boards

**Date**: 2026-02-27
**Status**: Design (reviewed, fixes applied)

## Goal

Navigate between session cards on any board layout (Kanban, list, future layouts) using keyboard shortcuts, without leaving the terminal or switching focus. The user holds `Cmd+Shift` (Mac) / `Ctrl+Shift` (Windows/Linux) and presses arrow keys to move spatially between cards.

## Interaction Model

### Highlight-then-Select

Arrow keys move a **keyboard focus ring** between cards. The focused card is visually distinct from the mouse-selected card. Pressing `Enter` selects the focused card (opens the detail panel, same as clicking it). Pressing `Escape` clears the focus ring and anchor.

- First press with no card focused: highlights the **first card** (top-left of the visible board).
- Mouse click anywhere: clears the keyboard focus ring and anchor (returns to mouse-driven mode).

### Spatial Navigation

Movement is **position-based**. The system reads the actual screen coordinates of all visible session cards and picks the nearest one in the arrow's direction.

- **Right**: Nearest card with greater X center
- **Left**: Nearest card with lesser X center
- **Down**: Nearest card with greater Y center
- **Up**: Nearest card with lesser Y center

When multiple candidates exist in the same direction, the one with the **smallest perpendicular distance** wins (most directly in line with the current position). This is the standard algorithm used by TV remote UIs and game console navigation.

### Wrapping

No dead ends. When you reach an edge, movement wraps:

- **Right at rightmost card**: Wrap to the leftmost card in the next row down. At the bottom-right, wrap to top-left (full loop).
- **Left at leftmost card**: Wrap to the rightmost card in the row above. At the top-left, wrap to bottom-right.
- **Down at bottom of column**: Wrap to the top of the next column to the right. At the bottom of the last column, wrap to the top of the first.
- **Up at top of column**: Wrap to the bottom of the previous column. At the top of the first column, wrap to the bottom of the last.

### Navigation Anchor (Phantom Position)

The system maintains a **navigation anchor** — an (x, y) screen coordinate representing where the user's "cursor" is, separate from the highlighted card's current position.

**Why**: Kanban cards move between columns as session status changes. If the user highlighted a card in the "Performing" column, and that card jumps to "Awaiting Input" between keypresses, the next arrow press should navigate from **where the user last was**, not where the card drifted to.

- Navigate to a card → anchor updates to that card's position at that moment
- Next arrow press → direction calculated from the anchor, not the highlighted card's current position
- Mouse click on a card → anchor moves to that card's position
- Board layout type changes → anchor resets
- **Panel resize → anchor resets** (absolute coordinates become stale after resize)

## Layout Compatibility

The navigation algorithm is layout-agnostic. It reads card positions from the DOM via `getBoundingClientRect()`. Any layout (current or future) that renders session cards as DOM elements works automatically:

| Layout | Left/Right feel | Up/Down feel |
|--------|----------------|--------------|
| Kanban horizontal (wide) | Move between columns | Move within a column |
| Kanban vertical (narrow) | Move between cards in a row (if any) | Move between sections |
| List/overview | Wraps vertically | Primary navigation |
| Any future layout | Just works | Just works |

## Technical Design

### VS Code Keybindings (package.json)

Five new commands registered with `when` clauses:

**Arrow navigation** — fires only when the Conductor panel is **focused** (not just visible):

```json
{
  "command": "conductor.navUp",
  "key": "ctrl+shift+up",
  "mac": "cmd+shift+up",
  "when": "conductor.panelFocused"
}
```

**Enter to select** — fires only when keyboard nav focus is active (prevents hijacking Enter in terminals/editors):

```json
{
  "command": "conductor.navSelect",
  "key": "enter",
  "when": "conductor.panelFocused && conductor.keyboardNavActive"
}
```

Commands: `conductor.navUp`, `conductor.navDown`, `conductor.navLeft`, `conductor.navRight`, `conductor.navSelect`.

**Context variables** (set by `DashboardPanel` via `vscode.commands.executeCommand('setContext', ...)`):

| Context key | Set when | Cleared when |
|---|---|---|
| `conductor.panelFocused` | `panel.onDidChangeViewState` fires with `active: true` | `active: false`, or panel disposed |
| `conductor.keyboardNavActive` | Webview sends `nav:keyboard-focus-changed` with `active: true` | Webview sends with `active: false`, or panel disposed |

### Shared Types (src/models/sharedConstants.ts)

```typescript
/** Spatial navigation directions for keyboard nav. */
export const NAV_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
} as const;

export type NavDirection = (typeof NAV_DIRECTIONS)[keyof typeof NAV_DIRECTIONS];
```

This avoids duplicating the `'up' | 'down' | 'left' | 'right'` union between `protocol.ts` and `spatialNav.ts`.

### Constants (src/constants.ts)

```typescript
export const COMMANDS = {
  // ... existing
  NAV_UP: 'conductor.navUp',
  NAV_DOWN: 'conductor.navDown',
  NAV_LEFT: 'conductor.navLeft',
  NAV_RIGHT: 'conductor.navRight',
  NAV_SELECT: 'conductor.navSelect',
} as const;

/** VS Code `when`-clause context keys set by the extension. */
export const CONTEXT_KEYS = {
  PANEL_FOCUSED: 'conductor.panelFocused',
  KEYBOARD_NAV_ACTIVE: 'conductor.keyboardNavActive',
} as const;
```

### IPC Protocol (src/models/protocol.ts)

New Extension → Webview messages:

```typescript
/** Extension-initiated spatial navigation (from Cmd+Shift+Arrow keybinding). */
| { type: 'nav:move'; direction: NavDirection }
/** Extension-initiated selection of the keyboard-focused card (from Enter keybinding). */
| { type: 'nav:select' }
```

New Webview → Extension message:

```typescript
/** Webview notifies the extension when keyboard nav focus changes (for `when` clause context). */
| { type: 'nav:keyboard-focus-changed'; active: boolean }
```

### Extension Command Registration (extension.ts)

Nav commands are registered in `extension.ts` alongside the existing four commands, following the established pattern. They forward to `DashboardPanel` via a new public method:

```typescript
// In extension.ts activate():
context.subscriptions.push(
  vscode.commands.registerCommand(COMMANDS.NAV_UP, () => {
    DashboardPanel.currentPanel?.navigate('up');
  }),
  vscode.commands.registerCommand(COMMANDS.NAV_DOWN, () => {
    DashboardPanel.currentPanel?.navigate('down');
  }),
  // ... NAV_LEFT, NAV_RIGHT, NAV_SELECT similarly
);
```

### DashboardPanel Changes (src/DashboardPanel.ts)

New public methods:

```typescript
/** Forward a spatial navigation command to the webview. */
public navigate(direction: NavDirection): void {
  this.postMessage({ type: 'nav:move', direction });
}

/** Forward a nav-select command to the webview. */
public selectKeyboardFocused(): void {
  this.postMessage({ type: 'nav:select' });
}
```

Panel focus tracking in constructor:

```typescript
this.panel.onDidChangeViewState(
  (e) => {
    vscode.commands.executeCommand(
      'setContext', CONTEXT_KEYS.PANEL_FOCUSED, e.webviewPanel.active
    );
  },
  null,
  this.disposables
);
```

Handle `nav:keyboard-focus-changed` in `handleMessage()`:

```typescript
case 'nav:keyboard-focus-changed':
  vscode.commands.executeCommand(
    'setContext', CONTEXT_KEYS.KEYBOARD_NAV_ACTIVE, message.active
  );
  break;
```

Clear both contexts in `dispose()`:

```typescript
vscode.commands.executeCommand('setContext', CONTEXT_KEYS.PANEL_FOCUSED, false);
vscode.commands.executeCommand('setContext', CONTEXT_KEYS.KEYBOARD_NAV_ACTIVE, false);
```

### Webview Store (dashboardStore.ts)

New state:

```typescript
keyboardFocusedSessionId: string | null;
navAnchor: { x: number; y: number } | null;
setKeyboardFocus: (sessionId: string | null, anchor?: { x: number; y: number }) => void;
clearKeyboardFocus: () => void;
```

`keyboardFocusedSessionId` is distinct from `focusedSessionId`. The keyboard focus is a visual highlight; `focusedSessionId` is the selected session with detail panel open.

### Navigation Hook (webview-ui/src/hooks/useKeyboardNav.ts)

**New hook** — encapsulates all navigation logic, consumed by `ConductorDashboard`:

```typescript
export function useKeyboardNav(): void {
  // Subscribes to nav:move and nav:select messages (via a secondary message listener
  // or by receiving direction from the main useVsCodeMessage handler).
  //
  // On nav:move(direction):
  //   1. Call getCardPositions() to read all card rects from the DOM
  //   2. Read navAnchor from store (or use first card if null)
  //   3. Call findNearestCard(anchor, direction, cards, currentId)
  //   4. If no result, call findWrapTarget(anchor, direction, cards)
  //   5. If result found:
  //      - Update keyboardFocusedSessionId + navAnchor in store
  //      - Scroll the card into view via element.scrollIntoView({ block: 'nearest' })
  //      - Post 'nav:keyboard-focus-changed' { active: true } to extension
  //   6. If no result (single card or empty board), no-op
  //
  // On nav:select:
  //   1. Read keyboardFocusedSessionId from store via useDashboardStore.getState()
  //      (not from a closure — avoids stale state)
  //   2. If non-null, call setFocusedSession(id) (same as click)
  //   3. Clear keyboard focus
  //
  // On mouse click (window listener):
  //   1. Clear keyboardFocusedSessionId and navAnchor
  //   2. Post 'nav:keyboard-focus-changed' { active: false } to extension
  //
  // On panel resize (ResizeObserver or window resize):
  //   1. Reset navAnchor to null (absolute coordinates are stale)
}
```

### Navigation Utility (webview-ui/src/utils/spatialNav.ts)

Split into **pure math functions** (testable without DOM) and a **thin DOM wrapper**:

```typescript
import type { NavDirection } from '@shared/sharedConstants';

export interface CardPosition {
  sessionId: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
}

// ── Pure functions (testable without DOM) ──────────────────────────

/** Find the nearest card from an anchor point in the given direction. */
export function findNearestCard(
  anchor: { x: number; y: number },
  direction: NavDirection,
  cards: CardPosition[],
  currentSessionId: string | null
): CardPosition | null;

/** Find the wrap-around target when no card exists in the given direction. */
export function findWrapTarget(
  anchor: { x: number; y: number },
  direction: NavDirection,
  cards: CardPosition[]
): CardPosition | null;

// ── DOM wrapper (not unit-tested, used at runtime) ─────────────────

/** Query all visible session card elements and return their positions. */
export function getCardPositions(): CardPosition[];
```

Cards are queried via a `data-session-id` attribute. The selector: `[data-session-id]`.

### Card DOM Attribute

- **KanbanCard**: Add `data-session-id={session.sessionId}` to its root `<div>`.
- **OverviewCard**: No change needed — the parent `OverviewPanel` already wraps each card in a `<div data-session-id={...}>`.

### Visual Focus Ring

Both `KanbanCard` and `OverviewCard` read `keyboardFocusedSessionId` **directly from the Zustand store** (avoids threading `isKeyboardFocused` through `KanbanBoard` → `KanbanColumn` → `KanbanCard` and `OverviewPanel` → `OverviewCard`):

```typescript
const isKeyboardFocused = useDashboardStore(
  (s) => s.keyboardFocusedSessionId === session.sessionId
);
```

When `isKeyboardFocused` is true:

- Box shadow: `0 0 0 2px var(--focus-border)` (avoids outline-offset overlap in tight Kanban gaps)
- No background change (keeps it visually distinct from selected state)

Focus ring is cleared on any mouse click via a window-level click listener in `useKeyboardNav`.

### IPC Message Handler (useVsCodeMessage.ts)

```typescript
case 'nav:move':
  handleNavMove(message.direction);
  break;
case 'nav:select':
  handleNavSelect();
  break;
```

These delegate to functions provided by `useKeyboardNav` (passed in or accessed via a ref/callback pattern).

### Help Text (strings.ts)

```typescript
HELP_KEY_NAV_ARROWS: '{modifier}+Shift+Arrows',
HELP_SHORTCUT_NAV_ARROWS: 'Navigate Between Sessions',
HELP_KEY_NAV_SELECT: 'Enter',
HELP_SHORTCUT_NAV_SELECT: 'Open Focused Session',
```

### SettingsDrawer (SettingsDrawer.tsx)

Add the two new shortcuts to the `SHORTCUTS` array so they appear in the Help & Shortcuts section.

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add 5 commands + 5 keybindings with `when` clauses |
| `src/constants.ts` | Add `NAV_*` to `COMMANDS`, add `CONTEXT_KEYS` object |
| `src/models/sharedConstants.ts` | Add `NAV_DIRECTIONS` const + `NavDirection` type |
| `src/models/protocol.ts` | Add `nav:move`, `nav:select` to Extension→Webview; add `nav:keyboard-focus-changed` to Webview→Extension |
| `src/extension.ts` | Register 5 nav commands forwarding to `DashboardPanel` |
| `src/DashboardPanel.ts` | Add `navigate()`, `selectKeyboardFocused()` public methods; track panel focus via `onDidChangeViewState`; handle `nav:keyboard-focus-changed`; clear contexts on dispose |
| `webview-ui/src/store/dashboardStore.ts` | Add `keyboardFocusedSessionId`, `navAnchor`, setters |
| `webview-ui/src/hooks/useKeyboardNav.ts` | **New** — keyboard navigation hook (move, select, anchor management, scroll-into-view, resize reset) |
| `webview-ui/src/hooks/useVsCodeMessage.ts` | Handle `nav:move` and `nav:select` messages |
| `webview-ui/src/utils/spatialNav.ts` | **New** — pure spatial nav algorithm + thin DOM wrapper |
| `webview-ui/src/components/KanbanCard.tsx` | Add `data-session-id`, read `keyboardFocusedSessionId` from store, render focus ring |
| `webview-ui/src/components/OverviewCard.tsx` | Read `keyboardFocusedSessionId` from store, render focus ring (no `data-session-id` needed — parent provides it) |
| `webview-ui/src/components/ConductorDashboard.tsx` | Consume `useKeyboardNav()` hook |
| `webview-ui/src/config/strings.ts` | Add nav shortcut help text |
| `webview-ui/src/components/SettingsDrawer.tsx` | Add nav shortcuts to `SHORTCUTS` array |
| `webview-ui/src/__tests__/spatialNav.test.ts` | **New** — tests for pure spatial nav functions (mock CardPosition data, no DOM needed) |
| `src/__tests__/DashboardPanel.test.ts` | Test `navigate()` / `selectKeyboardFocused()` methods and context key management |
