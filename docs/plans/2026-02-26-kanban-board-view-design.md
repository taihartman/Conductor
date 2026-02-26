# Kanban Board View Design

**Date**: 2026-02-26
**Status**: Approved

## Overview

A Kanban-style board view toggle for the OverviewPanel that groups sessions into 4 status columns. Pure UI feature — no backend or IPC changes needed. Sessions flow between columns automatically as the state machine transitions their status.

## Column Mapping

| Column | Statuses | Description |
|---|---|---|
| Performing | `working`, `thinking` | Actively doing AI work |
| Awaiting Input | `waiting` | Needs user response |
| Needs Attention | `error` | 3+ tool errors in 60s window |
| Completed | `done`, `idle` | Turn finished or resting |

## Data Flow

Existing `sessions` array from Zustand store already has `status` on every `SessionInfo`. The board groups by status instead of rendering a flat list. No new IPC messages or backend changes required.

## Store Changes

One new field: `overviewMode: 'list' | 'board'` with `setOverviewMode` action. Default: `'list'`.

## New Components

### `KanbanBoard.tsx`
Board container. Receives same props as OverviewPanel passes to list. Groups sessions into 4 columns, renders `KanbanColumn` for each.

### `KanbanColumn.tsx`
Single column. Header (label + count badge + status color bottom border) and scrollable list of `KanbanCard` components. Empty columns show "No sessions" placeholder.

### `KanbanCard.tsx`
Slim 3-row card:
- Row 1: StatusDot + session name
- Row 2: Context text (reuses `getContextText` logic from OverviewCard)
- Row 3: Cost + time-ago

## Modified Files

- **`OverviewPanel.tsx`** — List/board toggle button; render `KanbanBoard` when `overviewMode === 'board'`
- **`dashboardStore.ts`** — `overviewMode` field + `setOverviewMode`
- **`strings.ts`** — Column labels, toggle tooltip, empty column text
- **`colors.ts`** — Column header background tints

## Visual Design

- 4 equal-width columns (25% each), horizontal row
- Columns scroll vertically when cards overflow
- Column headers: label in status color + count badge + subtle bottom border
- Cards: `var(--bg-card)` background, 2px left border in status color
- Selected card: accent border (same as current)
- Empty columns: centered muted "No sessions" text, column stays at 25%
- Toggle button: list/grid icon in OverviewPanel header

## Interaction

- Single-click card: focus session (split view) — same as list
- Double-click card: expand to full detail — same as list
- Right-click: context menu — same as list
- Escape: collapse detail — same as list
- Drag-and-drop: not supported in board mode (list-only feature)
- Search: applied before grouping — only matching sessions appear

## Edge Cases

- All sessions in one column: other columns show placeholder, stable layout
- Status changes: cards move columns on next render (no animation v1)
- Sub-agents: already filtered out before reaching OverviewPanel
- Hidden tab: board toggle works on both tabs
- Search: filters before column grouping

## Not in Scope (v1)

- Drag cards between columns (would require sending commands to agents)
- Transition animations between columns
- Customizable column ordering or visibility
- Collapsible columns
