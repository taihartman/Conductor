# Kanban Board: Adaptive Layout & Sort

## Problem

The 4-column horizontal kanban layout gets squeezed at narrow panel widths. Empty columns waste space. Sessions within columns have no meaningful order.

## Design

### Adaptive Layout

A `ResizeObserver` on the KanbanBoard container measures width. Below `SIZES.KANBAN_VERTICAL_BREAKPOINT` (500px), the board switches from horizontal columns to vertical stacked rows.

**Horizontal mode (>=500px):** Same as today — 4 columns left-to-right: Performing → Awaiting Input → Needs Attention → Completed. Empty columns show "No sessions" placeholder.

**Vertical mode (<500px):** Columns become full-width rows stacked top-to-bottom in priority order: Needs Attention → Awaiting Input → Performing → Completed. Empty rows are not rendered at all — they reappear the moment a session enters that state.

Each vertical row has a max-height (`SIZES.KANBAN_VERTICAL_ROW_MAX_HEIGHT`, 200px, enough for ~3 cards) so that a row with many sessions (e.g. Completed) doesn't push everything else off screen. Overflow scrolls vertically within that row.

The switch is instant (no animation).

#### ResizeObserver lifecycle

KanbanBoard uses a `useRef` + `useEffect` pattern matching the existing `TerminalView.tsx` precedent:

```tsx
const containerRef = useRef<HTMLDivElement>(null);
const [isVertical, setIsVertical] = useState(false);

useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    const shouldBeVertical = width < SIZES.KANBAN_VERTICAL_BREAKPOINT;
    setIsVertical((prev) => (prev === shouldBeVertical ? prev : shouldBeVertical));
  });
  observer.observe(el);
  return () => observer.disconnect();
}, []);
```

The functional updater avoids unnecessary re-renders when the boolean doesn't change. No debounce is needed — React's batching handles rapid resize events.

#### Column ordering — single source of truth

One `COLUMNS` array defines all column metadata. A separate `VERTICAL_COLUMN_ORDER` key array defines the priority ordering for vertical mode:

```ts
const VERTICAL_COLUMN_ORDER = ['error', 'awaiting', 'performing', 'completed'] as const;
```

The board derives the ordered list at render time:

```ts
const orderedColumns = isVertical
  ? VERTICAL_COLUMN_ORDER.map((key) => COLUMNS.find((c) => c.key === key)!)
  : COLUMNS;
```

#### Empty-row filtering at KanbanBoard level

In vertical mode, KanbanBoard skips rendering a `KanbanColumn` entirely when its session count is zero. KanbanColumn receives no `isVertical` prop — it stays layout-agnostic. The max-height override for vertical mode is applied by KanbanBoard via a wrapper div around each column.

### Sort

A new exported `sortColumnSessions()` function sorts each column's sessions by `lastActivityAt` descending (most recent first). It is applied **after** `groupSessionsByColumn()` in the `useMemo` pipeline:

```ts
const grouped = useMemo(() => {
  const groups = groupSessionsByColumn(sessions);
  return sortColumnSessions(groups);
}, [sessions]);
```

`groupSessionsByColumn()` is unchanged — it groups only, preserving its existing test contract. `sortColumnSessions()` is independently testable.

ISO 8601 strings sort lexicographically, so simple string comparison (`b.lastActivityAt > a.lastActivityAt`) is used — no Date parsing needed.

### What Doesn't Change

Card design (KanbanCard), context menus, click behavior, cost/time display, KanbanColumn internals — none of that changes. Only the KanbanBoard container adapts layout and applies sort.

## Implementation Tasks

### Task 1: Add constants to `SIZES` in `colors.ts`

- `KANBAN_VERTICAL_BREAKPOINT`: `500` (number, not string — used in numeric comparison)
- `KANBAN_VERTICAL_ROW_MAX_HEIGHT`: `'200px'` (string — used in style objects)

### Task 2: Add `sortColumnSessions()` to `KanbanBoard.tsx`

New exported function:
```ts
export function sortColumnSessions(
  grouped: Map<string, SessionInfo[]>
): Map<string, SessionInfo[]> {
  const sorted = new Map<string, SessionInfo[]>();
  for (const [key, sessions] of grouped) {
    sorted.set(key, [...sessions].sort((a, b) =>
      b.lastActivityAt > a.lastActivityAt ? 1 : b.lastActivityAt < a.lastActivityAt ? -1 : 0
    ));
  }
  return sorted;
}
```

### Task 3: Add adaptive layout to `KanbanBoard.tsx`

- Add `containerRef`, `isVertical` state, `useEffect` with ResizeObserver + cleanup
- Add `VERTICAL_COLUMN_ORDER` constant
- Derive `orderedColumns` from `isVertical`
- Filter out empty columns when `isVertical`
- Wrap each `KanbanColumn` in a div that applies `maxHeight` + `overflow: auto` when vertical
- Change container `flexDirection` based on `isVertical`
- Add `isVertical` to `useMemo` dependency array for grouped/sorted result

### Task 4: Tests for `sortColumnSessions()`

- Sessions with different `lastActivityAt` → sorted descending
- Sessions with identical `lastActivityAt` → stable order preserved
- Empty column → remains empty (no error)

### Task 5: Tests for adaptive layout logic

- Vertical column ordering: keys come back in `['error', 'awaiting', 'performing', 'completed']` order
- Empty-row filtering: columns with 0 sessions are excluded when vertical
- All columns empty → no columns rendered in vertical mode
- `groupSessionsByColumn` existing tests remain unchanged (sort is separate)

## Files Changed

- `webview-ui/src/config/colors.ts` — Add `KANBAN_VERTICAL_BREAKPOINT` and `KANBAN_VERTICAL_ROW_MAX_HEIGHT` to `SIZES`
- `webview-ui/src/components/KanbanBoard.tsx` — ResizeObserver, isVertical state, VERTICAL_COLUMN_ORDER, empty filtering, sortColumnSessions, wrapper div for max-height
- `src/__tests__/KanbanBoard.test.ts` — New tests for sort and vertical layout; existing tests unchanged
