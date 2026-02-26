# Stable Card Ordering with Drag-to-Reorder

## Problem

Session cards sort by `lastActivityAt` on every update cycle (~100ms). Any session that does work jumps to the front of the grid, causing all other cards to shift. This makes the dashboard disorienting.

## Solution

1. **Default sort: creation time** — Sessions sort by `startedAt` timestamp. Once a card appears, it stays in position regardless of activity.
2. **Drag-to-reorder with persistence** — Users can drag cards to custom positions via a drag handle. Custom order persists across reloads via VS Code workspace state.

## Sort Behavior

- New sessions append to the **end** of the grid (most recent creation last).
- Status changes (active/idle/done) do **not** move cards.
- If the user has never dragged, creation-time order is the only order.
- Once the user drags a card, the custom order takes priority.

## Responsibility Separation

- **SessionTracker** — Returns sessions in stable creation-time order (`startedAt` ascending). No knowledge of custom ordering.
- **DashboardPanel** — Applies custom order from `ISessionOrderStore` before sending to webview, alongside existing `applyCustomNames()`. Owns presentation-layer concerns.
- **OverviewPanel** — Renders cards in received order. Owns drag interaction and posts `session:reorder` messages.

## Drag-and-Drop Mechanics

### Implementation: Pointer Events

HTML5 Drag and Drop is unreliable inside VS Code webview iframes (the outer VS Code frame intercepts drag events for tab/file dragging). Pointer events give full control and naturally support a movement threshold.

**Drag handle approach**: A small grip icon on the left edge of each card is the drag zone. The rest of the card retains existing click/double-click behavior with zero interaction conflicts.

**Pointer event flow**:

1. `onPointerDown` on drag handle — record start position, set `isDragPending = true`.
2. `onPointerMove` (document-level) — if pending and movement > 5px threshold, enter drag mode. Create a visual clone of the card that follows the pointer.
3. During drag — compute drop index from pointer position relative to card grid positions. Show insertion indicator.
4. `onPointerUp` — if in drag mode, finalize reorder and post `session:reorder`. If never crossed threshold, treat as no-op.
5. Cleanup — remove pointer move/up listeners, reset drag state.

### Visual Feedback

- **Drag handle**: grip/dots icon (e.g. `⠿` or a CSS grip pattern) at left edge of card, visible on hover.
- **Dragged card**: reduced opacity (0.4) at original position.
- **Drag clone**: semi-transparent copy following the pointer with slight scale-up.
- **Drop indicator**: colored border or insertion line at the computed drop position.

### Grid Position Calculation

The CSS grid uses `auto-fill, minmax(280px, 1fr)`, producing a multi-column layout. Drop index is computed by:

1. Get bounding rects of all visible cards.
2. Find which card the pointer is closest to (center-to-center distance).
3. Determine before/after based on pointer position relative to that card's center (left half = before, right half = after).

## Persistence

### New Interface: `ISessionOrderStore`

Follows the existing `ISessionNameStore` pattern for consistency and testability.

```typescript
export interface ISessionOrderStore extends vscode.Disposable {
  /** Get the persisted session ID order. Returns empty array if none saved. */
  getOrder(): string[];
  /** Save a new session ID order. */
  setOrder(sessionIds: string[]): Promise<void>;
}
```

Implementation uses `context.workspaceState` (not `globalState`) because session IDs are workspace-scoped.

- **Key**: `conductor.sessionOrder`
- **Value**: `string[]` — ordered array of session IDs.

### Reconciliation (Memoized)

Reconciliation only runs when the **set** of session IDs changes (not on every render). Tracked by comparing a sorted hash of current IDs against the previous.

1. Start with the saved order array.
2. Remove any IDs not in the live session set (stale pruning).
3. Append any live session IDs not in the saved order (new sessions go to end, sorted by `startedAt`).
4. If the reconciled order differs from saved, persist immediately so new session positions are stable.
5. Cache the result until the session ID set changes.

## IPC Protocol

### New message: `session:reorder` (Webview -> Extension)

```typescript
| { type: 'session:reorder'; sessionIds: string[] }
```

Sent when the user completes a drag-and-drop. The extension receives the new order and writes it to workspace state via `ISessionOrderStore`.

### Modified behavior: `sessions:update` (Extension -> Webview)

`DashboardPanel.postFullState()` applies custom order (via `applyCustomOrder()`) after receiving creation-time-sorted sessions from `SessionTracker.getState()`, before sending to the webview. The webview receives sessions pre-sorted.

## Interaction with Existing Features

### Click/Double-click

Drag is confined to the grip handle. The card body retains click (select) and double-click (rename) without interference.

### Filtering (active/recent/all)

The drag order applies to the full session list. `Array.filter()` preserves relative order, so filtered views naturally respect the custom ordering.

### Sub-agents

Sub-agents are already filtered out of the overview grid (`!s.isSubAgent`). They are not part of the drag order.

## Files to Modify

| File | Change |
|---|---|
| `src/monitoring/SessionTracker.ts` | Change sort from `lastActivityAt` to `startedAt` ascending. |
| `src/models/protocol.ts` | Add `session:reorder` to `WebviewToExtensionMessage` union. |
| `src/persistence/ISessionOrderStore.ts` | **New.** Interface for order persistence. |
| `src/persistence/SessionOrderStore.ts` | **New.** Implementation using `workspaceState`. |
| `src/DashboardPanel.ts` | Inject `ISessionOrderStore`, handle `session:reorder`, add `applyCustomOrder()`. |
| `src/extension.ts` | Create `SessionOrderStore` and pass to `DashboardPanel.createOrShow()`. |
| `src/constants.ts` | Add `WORKSPACE_STATE_KEYS.SESSION_ORDER` constant. |
| `webview-ui/src/components/OverviewPanel.tsx` | Add pointer-event drag handlers, drop indicator, drag handle rendering. |
| `webview-ui/src/components/OverviewCard.tsx` | Add drag handle icon (visible on hover). |
| `webview-ui/src/config/colors.ts` | Add drag indicator color constants. |
| `webview-ui/src/config/strings.ts` | Add drag-related UI strings (tooltip, ARIA labels). |

## Testing Strategy

| Component | Tests |
|---|---|
| `SessionOrderStore` | Persistence round-trip, empty state, corrupted data handling. |
| Reconciliation logic | Stale pruning, new session appending, order stability, memoization. |
| `DashboardPanel` | `session:reorder` message handling (mock `ISessionOrderStore`). |
| `SessionTracker` | Verify `getState()` returns `startedAt`-sorted sessions. |
| Drag handle (OverviewPanel) | Pointer threshold logic, order mutation on drop, visual state transitions. |

## Out of Scope (Current Phase)

- "Reset order" button (future enhancement if needed).
- Animated card transitions during reorder (keep it simple).
- Keyboard reordering with Ctrl+Arrow (accessibility follow-up).

## Planned Follow-Up: Multi-Select with Session Removal

After stable ordering and drag-to-reorder ship, add multi-select for bulk actions (primarily removing/hiding sessions):

- **Click** — single select (existing behavior).
- **Ctrl/Cmd+Click** — toggle individual card selection.
- **Shift+Click** — range select (from last selected to clicked card).
- **Bulk action**: remove/hide selected sessions from the dashboard.
- Standard platform conventions (Cmd on macOS, Ctrl on Windows/Linux).
