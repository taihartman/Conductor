# Multi-Session Tiling Workspace

**Date**: 2026-02-27
**Status**: Design

## Goal

Replace the single-session detail panel with a flexible tiling workspace where users can open multiple session panels simultaneously, arrange them via drag-and-drop splits, resize dividers freely, and save/restore named layout presets. Every open tile is live — terminals stream data, conversations update in real-time.

## Mental Model

The overview panel (kanban/grid) stays on the left as the session picker. The right side becomes a **tiling area** where dragging a session card creates a panel, and dragging to an edge of an existing panel splits it. Think VS Code editor splits, but for Claude Code agent sessions.

---

## Data Model

### Recursive Tile Tree

The layout is a binary tree. Each node is either a **leaf** (renders a session) or a **split** (two children with a direction and size ratio).

```typescript
// src/models/types.ts

/** Recursive binary tree representing tiled panel arrangement. */
export type TileNode =
  | { type: 'leaf'; id: string; sessionId: string | null }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      children: [TileNode, TileNode];
      sizes: [number, number]; // percentages, e.g. [50, 50]
    };

/** Saved layout preset with session hints and orientation. */
export interface SavedTileLayout {
  name: string;
  root: TileNode;
  layoutOrientation: 'horizontal' | 'vertical';
  createdAt: string; // ISO 8601
}
```

Examples:

```
Single session:
  { type: 'leaf', id: 't1', sessionId: 'abc' }

Two side-by-side:
  { type: 'split', id: 's1', direction: 'horizontal',
    children: [
      { type: 'leaf', id: 't1', sessionId: 'abc' },
      { type: 'leaf', id: 't2', sessionId: 'def' }
    ],
    sizes: [50, 50] }

Two stacked left + one right:
  { type: 'split', id: 's1', direction: 'horizontal',
    children: [
      { type: 'split', id: 's2', direction: 'vertical',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'def' }
        ],
        sizes: [50, 50] },
      { type: 'leaf', id: 't3', sessionId: 'ghi' }
    ],
    sizes: [50, 50] }
```

### Shared Constants

```typescript
// src/models/sharedConstants.ts

export const TILE_NODE_TYPES = {
  LEAF: 'leaf',
  SPLIT: 'split',
} as const;

export const SPLIT_DIRECTIONS = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
} as const;
```

### Detail View Mode

Tiling integrates as a new mode in the existing view system:

```typescript
export const DETAIL_VIEW_MODES = {
  OVERVIEW_ONLY: 'overview-only',
  SPLIT: 'split',
  EXPANDED: 'expanded',
  TILING: 'tiling', // NEW
} as const;
```

When `detailViewMode === 'tiling'`, the right side renders the `TileNode` tree instead of a single `DetailPanel`. The overview panel stays on the left as the session picker.

---

## Store Changes (Zustand)

### New State Fields

```typescript
// Per-session data Maps (follows existing ptyBuffers/viewModes pattern)
activitiesBySession: Map<string, ActivityEvent[]>;
conversationBySession: Map<string, ConversationTurn[]>;

// Tiling state
tileRoot: TileNode | null;            // null = classic single-focus mode
activeTileId: string | null;          // tile with keyboard/command focus
savedTileLayouts: SavedTileLayout[];  // persisted presets
```

### New Actions

```typescript
splitTile: (tileId: string, direction: 'horizontal' | 'vertical',
            sessionId: string) => void;
closeTile: (tileId: string) => void;
setTileSizes: (splitId: string, sizes: [number, number]) => void;
setTileSession: (tileId: string, sessionId: string | null) => void;
setActiveTile: (tileId: string) => void;
saveTileLayout: (name: string) => void;
restoreTileLayout: (layout: SavedTileLayout) => void;
exitTilingMode: () => void;
```

### Derived Value

`subscribedSessionIds` is computed by walking the `tileRoot` tree and collecting non-null `sessionId` values from leaf nodes. It is NOT stored separately — derived on demand to prevent sync bugs.

### Backward Compatibility

When `tileRoot === null`, the dashboard works exactly as today — single `focusedSessionId`, same SPLIT/EXPANDED/OVERVIEW_ONLY modes. Tiling activates the moment a user drags a second session into the detail area. The existing flat `activities` and `conversation` arrays continue to work for classic mode.

---

## IPC Protocol Changes

### New Messages

```typescript
// Webview → Extension
| { type: 'tile:subscribe'; sessionId: string }
| { type: 'tile:unsubscribe'; sessionId: string }
| { type: 'tile-layouts:save'; layouts: SavedTileLayout[] }

// Extension → Webview
| { type: 'tile-layouts:current'; layouts: SavedTileLayout[] }
```

### Reused Existing Messages

- `activity:full` — already has `sessionId` field, used per-tile
- `conversation:full` — already has `sessionId` field, used per-tile
- `pty:data` — already per-session, no changes
- `state:full` — continues sending all sessions metadata, toolStats, tokenSummaries

### Extension-Side Changes (DashboardPanel)

1. Add `subscribedSessionIds: Set<string>` field.
2. On `tile:subscribe(sessionId)`: add to set, immediately send `activity:full` + `conversation:full` for that session.
3. On `tile:unsubscribe(sessionId)`: remove from set.
4. On `postFullState()` debounce tick: after sending `state:full`, iterate `subscribedSessionIds` and send `activity:full` + `conversation:full` for each.
5. `session:focus` continues to work — maps to `activeTileId`'s session for command palette context and keyboard shortcuts.

### Webview-Side Changes (useVsCodeMessage + Store)

1. When `activity:full` arrives, always store in `activitiesBySession` Map (keyed by `message.sessionId`), regardless of focus match.
2. When `conversation:full` arrives, always store in `conversationBySession` Map.
3. In classic mode: continue reading from flat arrays (unchanged behavior).
4. In tiling mode: each tile's `DetailPanel` reads from the Maps via `tileSessionId` prop.

---

## DetailPanel: Multi-Session Data Access

**Problem:** DetailPanel reads `conversation`, `activities`, `toolStats` directly from the flat Zustand store — not from props. Multiple DetailPanels would all show the same data.

**Solution:** Add an optional `tileSessionId` prop. When set, DetailPanel reads from per-session Maps instead of flat arrays.

```typescript
interface DetailPanelProps {
  session: SessionInfo;
  isExpanded: boolean;
  onToggleExpand: () => void;
  tileSessionId?: string; // NEW — when set, reads from Maps
}
```

Inside DetailPanel, each store read conditionally switches:

```typescript
const conversation = useDashboardStore(
  useCallback(
    (s) =>
      tileSessionId
        ? (s.conversationBySession.get(tileSessionId) ?? [])
        : s.conversation,
    [tileSessionId]
  )
);
```

Classic mode: no `tileSessionId` passed → reads flat arrays (zero behavior change). Tiling mode: each tile passes its `tileSessionId` → Zustand's equality check means only that tile re-renders when its session's data changes.

---

## Rendering

### ConductorDashboard Tiling Mode

```tsx
// detailViewMode === 'tiling'
<Group orientation={layoutOrientation}>
  <Panel id="overview" minSize="15%" maxSize="40%">
    <OverviewPanel ... />
  </Panel>
  <Separator />
  <Panel id="tiling-workspace">
    <TilingWorkspace root={tileRoot} />
  </Panel>
</Group>
```

### TilingWorkspace (Recursive Renderer)

Maps the `TileNode` tree to nested `react-resizable-panels` (v4.6.5, already installed, supports nesting):

```tsx
function TilingWorkspace({ root }: { root: TileNode }) {
  if (root.type === 'leaf') {
    return root.sessionId
      ? <TilePanel tileId={root.id} sessionId={root.sessionId} />
      : <EmptyTile tileId={root.id} />;
  }

  return (
    <Group orientation={root.direction}>
      <Panel id={`${root.id}-0`} defaultSize={root.sizes[0]}>
        <TilingWorkspace root={root.children[0]} />
      </Panel>
      <Separator />
      <Panel id={`${root.id}-1`} defaultSize={root.sizes[1]}>
        <TilingWorkspace root={root.children[1]} />
      </Panel>
    </Group>
  );
}
```

### TilePanel (Tile Chrome + DetailPanel)

```tsx
function TilePanel({ tileId, sessionId }: Props) {
  const session = useDashboardStore(
    s => s.sessions.find(s => s.sessionId === sessionId)
  );
  const isActive = useDashboardStore(s => s.activeTileId === tileId);

  if (!session) return <EmptyTile tileId={tileId} />;

  return (
    <div
      data-tile-id={tileId}
      onClick={() => setActiveTile(tileId)}
      style={{
        height: '100%',
        outline: isActive ? '1px solid var(--focus-border)' : 'none',
      }}
    >
      <DetailPanel
        session={session}
        isExpanded={false}
        onToggleExpand={noop}
        tileSessionId={sessionId}
      />
    </div>
  );
}
```

### EmptyTile

Renders when a leaf has `sessionId: null`. Shows a minimal placeholder with instructional text ("Drag a session here") and accepts drop events.

---

## Drag-to-Split Interaction

### The Problem

The existing `useDragReorder` hook uses `setPointerCapture()`, which locks all pointer events to the overview grid. A card dragged over the tiling workspace won't trigger events there.

### Solution: Extend useDragReorder + Position-Based Hit Testing

Add an `onDropOutside(sessionId, clientX, clientY)` callback to `useDragReorder`. When the pointer is released outside the grid container, this callback fires instead of reordering.

**Flow:**

1. User starts dragging a card from overview (same pointer capture as today).
2. Ghost element follows cursor (reuse existing ghost creation logic).
3. During drag, ConductorDashboard checks cursor position against tile bounding rects (via `document.querySelectorAll('[data-tile-id]')`). When cursor enters a tile's edge zone, that zone highlights.
4. On release inside overview grid → reorder (existing behavior, unchanged).
5. On release outside grid (over tiling workspace) → `onDropOutside` fires:
   - Find which `[data-tile-id]` element the cursor is over.
   - Compute which **edge** is closest (top/bottom → vertical split, left/right → horizontal split).
   - Call `splitTile(tileId, direction, sessionId)`.

### Drop Zone Detection (Position Math)

Since pointer events are captured by the overview grid, drop zones can't use DOM events. Instead, on every `pointerMove`, check cursor coordinates against tile bounding rects:

```typescript
function findDropTarget(clientX: number, clientY: number): DropTarget | null {
  const tiles = document.querySelectorAll('[data-tile-id]');
  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;
    if (clientY < rect.top || clientY > rect.bottom) continue;

    // Inside this tile — which edge?
    const edgeThreshold = Math.min(rect.width, rect.height) * 0.25;
    if (clientX - rect.left < edgeThreshold) return { tileId, edge: 'left' };
    if (rect.right - clientX < edgeThreshold) return { tileId, edge: 'right' };
    if (clientY - rect.top < edgeThreshold) return { tileId, edge: 'top' };
    if (rect.bottom - clientY < edgeThreshold) return { tileId, edge: 'bottom' };

    // Center = replace session in this tile (no split)
    return { tileId, edge: 'center' };
  }
  return null;
}
```

### Visual Feedback During Drag

Each tile renders 4 invisible edge overlays + 1 center overlay via `TileDropZones`. During a drag, the active zone highlights with a blue semi-transparent fill (matching the existing `COLORS.DRAG_INDICATOR` palette). The zones are CSS-positioned, not DOM event driven — their visibility is toggled by a shared drag context state.

### KanbanCard Drag Support

KanbanCard currently has no drag capability. Add `onDragHandlePointerDown` prop (same interface as OverviewCard), active only when tiling mode is enabled. This allows dragging sessions from Kanban columns into tiles.

---

## Saved Layouts

### Persistence Pattern

Follows the existing `SessionOrderStore` / `kanbanSortOrders` pattern:

1. **Storage key:** `WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS = 'conductor.savedTileLayouts'`
2. **Store class:** `TileLayoutStore` with in-memory cache + async `workspaceState` persist
3. **Interface:** `ITileLayoutStore` with `getLayouts()`, `setLayouts()`, `onLayoutsChanged`
4. **Error handling:** Corrupted data resets to empty array, logged but not thrown

### Save Flow

```
User clicks "Save Layout" button in tile workspace header
  → saveTileLayout(name) in Zustand
  → Serializes current tileRoot + layoutOrientation into SavedTileLayout
  → vscode.postMessage({ type: 'tile-layouts:save', layouts })
  → Extension persists to workspaceState
```

### Restore Flow

```
User picks a saved layout from dropdown
  → restoreTileLayout(layout)
  → Walk the tree: for each leaf with sessionId, check if session exists
    → If session exists: keep sessionId (auto-assign)
    → If session gone: set sessionId to null (empty tile)
  → Apply layoutOrientation from saved layout
  → Set tileRoot to the restored tree
  → For each non-null sessionId: send tile:subscribe
```

### Boot Hydration

On `ready`, extension sends `tile-layouts:current` with the saved presets (after `postFullState()` so sessions are available). The webview stores them in `savedTileLayouts` but does NOT auto-restore a layout — the user starts in classic mode and opts into tiling.

---

## Edge Cases & Mitigations

### Terminal Resize in Narrow Tiles

**Problem:** `xterm.js` FitAddon fails silently when container is < ~80px wide. AnalyticsDrawer is 300px fixed, EnsembleList is 220px fixed. Both open in a 400px tile = negative center width.

**Mitigations:**

| Constraint | Value | Rationale |
|---|---|---|
| Tile minimum width | 350px | Enough for terminal without drawer |
| Tile minimum height | 200px | Header + stats bar + usable content area |
| Auto-close analytics drawer | When tile < 500px wide | Prevents negative center |
| Hide ensemble sidebar | When tile < 450px wide | Prevents center squeeze |
| Guard fitAddon.fit() | Skip when container width or height is 0 | Prevent silent failure |

### Global forceRelayout() Broadcast

**Problem:** One tile becoming visible triggers `window.dispatchEvent(new Event('resize'))` which hits ALL tiles simultaneously, causing layout thrash with multiple terminals.

**Mitigation:** Debounce `forceRelayout()` by 50ms. Guard `fitAddon.fit()` with a dimension check before calling.

### Saved Layout Orientation Mismatch

**Problem:** A layout saved in horizontal orientation may violate panel constraints when restored in vertical.

**Mitigation:** `SavedTileLayout` includes `layoutOrientation`. Restoring a layout also applies its saved orientation.

### Stale Data in Per-Session Maps

**Problem:** If a session ends while a tile is showing it, the Map retains stale data.

**Mitigation:** On `tile:unsubscribe`, clear the session's entries from `activitiesBySession` and `conversationBySession`. On session removal from `state:full`, clean up orphaned Map entries.

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `src/persistence/ITileLayoutStore.ts` | Interface for tile layout persistence |
| `src/persistence/TileLayoutStore.ts` | workspaceState-backed store with in-memory cache |
| `webview-ui/src/components/TilingWorkspace.tsx` | Recursive TileNode → nested PanelGroup renderer |
| `webview-ui/src/components/TilePanel.tsx` | Tile chrome (active border, close button) + DetailPanel |
| `webview-ui/src/components/EmptyTile.tsx` | Placeholder for tiles without a session assigned |
| `webview-ui/src/components/TileDropZones.tsx` | Edge drop zone overlays for drag-to-split visual feedback |
| `webview-ui/src/hooks/useDragToTile.ts` | Cross-panel drag detection and drop zone hit testing |
| `webview-ui/src/utils/tileTree.ts` | Pure functions: splitNode, removeNode, walkLeaves, getSubscribedIds, generateTileId |

### Modified Files

| File | Change |
|---|---|
| `src/constants.ts` | Add `WORKSPACE_STATE_KEYS.SAVED_TILE_LAYOUTS`, tile sizing constants (`TILE_MIN_WIDTH`, `TILE_MIN_HEIGHT`) |
| `src/models/sharedConstants.ts` | Add `TILE_NODE_TYPES`, `SPLIT_DIRECTIONS`, `DETAIL_VIEW_MODES.TILING` |
| `src/models/types.ts` | Add `TileNode`, `SavedTileLayout` types |
| `src/models/protocol.ts` | Add `tile:subscribe`, `tile:unsubscribe`, `tile-layouts:save`, `tile-layouts:current` messages |
| `src/DashboardPanel.ts` | Add `subscribedSessionIds` set, per-session data emission loop in `postFullState()`, tile layout store injection, `tile:subscribe`/`tile:unsubscribe`/`tile-layouts:save` handlers, `postCurrentTileLayouts()` in `ready` sequence |
| `webview-ui/src/store/dashboardStore.ts` | Add `tileRoot`, `activeTileId`, `savedTileLayouts`, `activitiesBySession` Map, `conversationBySession` Map, all tile actions |
| `webview-ui/src/hooks/useVsCodeMessage.ts` | Handle `tile-layouts:current`, store per-session `activity:full`/`conversation:full` in Maps |
| `webview-ui/src/hooks/useDragReorder.ts` | Add `onDropOutside(sessionId, clientX, clientY)` callback for cross-panel drag |
| `webview-ui/src/components/ConductorDashboard.tsx` | Add `TILING` mode rendering branch, wire `onDropOutside` to tile splitting |
| `webview-ui/src/components/DetailPanel.tsx` | Add optional `tileSessionId` prop, conditional Map-based store reads for activities/conversation/tokenSummaries |
| `webview-ui/src/components/TerminalView.tsx` | Guard `fitAddon.fit()` against 0-dimension containers, debounce resize observer |
| `webview-ui/src/components/OverviewCard.tsx` | No changes needed (drag handle already exists) |
| `webview-ui/src/components/KanbanCard.tsx` | Add optional `onDragHandlePointerDown` prop for tiling mode |
| `webview-ui/src/config/colors.ts` | Add `TILE_DROP_ZONE_*` highlight colors, `TILE_ACTIVE_BORDER` |
| `webview-ui/src/config/strings.ts` | Add tile-related UI strings (empty tile prompt, save layout dialog, layout names) |
| `webview-ui/src/utils/layout.ts` | Debounce `forceRelayout()` by 50ms |

---

## What Does NOT Change

- **SessionTracker** — no changes to JSONL processing, state machine, or data emission
- **PtyBridge / SessionLauncher** — terminal data pipeline is already fully multi-session
- **PTY ring buffers** — already per-session Maps, no changes
- **Overview panel / Kanban board** — unchanged (still the session picker)
- **Header / tabs / settings** — unchanged
- **History / Usage panels** — unchanged
- **Existing IPC messages** — `state:full`, `pty:data`, `pty:buffers` all unchanged

---

## Key UX Principle: Overview Always Reflects All Sessions

Opening a session in a tile does **NOT** remove it from the overview panel. The kanban board and list view always show every session regardless of whether it's open in a tile. This matches VS Code's behavior — the file explorer still shows files that are open in editor tabs.

Specifically:
- Session cards in the overview remain fully interactive (click to focus, drag to tile, context menu) even if the session is already in a tile.
- Dragging a session that's already in one tile to another tile's edge creates a **second tile** for the same session (both show live data — they share the same `activitiesBySession` / `conversationBySession` Map entry).
- The overview's filter modes (recent / active / all), search, and kanban column grouping continue working identically in tiling mode.
- During a drag operation, the overview panel remains fully visible and rendered. The ghost element floats over both the overview and tiling workspace.

---

## Activation & Entry Points

1. **Drag a second session** from overview into the detail area → auto-activates tiling mode.
2. **Toolbar button** "Enter Tiling Mode" in the detail area header → creates a single leaf tile from the currently focused session, then user can split from there.
3. **Restore a saved layout** from the layout picker dropdown.
4. **Exit tiling mode** via toolbar button or Escape when only one tile remains → returns to classic single-focus mode.
