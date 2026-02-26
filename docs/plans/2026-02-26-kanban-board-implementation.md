# Kanban Board View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Kanban board view toggle to the OverviewPanel that groups sessions into 4 status columns (Performing, Awaiting Input, Needs Attention, Completed).

**Architecture:** Pure frontend feature — no backend/IPC changes. A new `overviewMode` store field toggles between existing list and new board. Three new components (`KanbanBoard`, `KanbanColumn`, `KanbanCard`) render sessions grouped by status. `getContextText` is extracted from `OverviewCard` to a shared utility so both card types reuse it.

**Tech Stack:** React 19, Zustand 5, TypeScript (strict mode). All constants in centralized config files per project rules.

**Design doc:** `docs/plans/2026-02-26-kanban-board-view-design.md`

**Review revisions:** Addresses all findings from staff-engineer review:
- Added test tasks for `getContextText`, store `overviewMode`, and session grouping logic
- Added context menu support (hide/unhide/rename) to `KanbanCard`
- Removed COLORS CSS-variable wrappers — uses `STATUS_CONFIG[status].cssVar` directly
- Added fallback for unrecognized session statuses in grouping logic
- Eliminated duplicate `costBySession` computation (computed once in `OverviewPanel`, passed as prop)
- Fixed `getContextText` double-call by assigning to local variable
- Placed toggle button outside scrollable region

---

### Task 1: Add store state and strings constants

**Files:**
- Modify: `webview-ui/src/store/dashboardStore.ts`
- Modify: `webview-ui/src/config/strings.ts`

**Step 1: Add overview mode constants and state to Zustand store**

In `dashboardStore.ts`, add the overview mode discriminator after `LAYOUT_ORIENTATIONS` (line ~30):

```typescript
/** Overview panel display mode discriminators. */
export const OVERVIEW_MODES = {
  LIST: 'list',
  BOARD: 'board',
} as const;

export type OverviewMode = (typeof OVERVIEW_MODES)[keyof typeof OVERVIEW_MODES];
```

Add to `DashboardState` interface:

```typescript
overviewMode: OverviewMode;
setOverviewMode: (mode: OverviewMode) => void;
```

Add to store initialization (after `activeTab: 'sessions'`):

```typescript
overviewMode: OVERVIEW_MODES.LIST,
setOverviewMode: (mode) => set({ overviewMode: mode }),
```

**Step 2: Add Kanban strings to `strings.ts`**

Add to `UI_STRINGS` (before the closing `} as const`):

```typescript
/** Kanban board column labels */
KANBAN_COL_PERFORMING: 'Performing',
KANBAN_COL_AWAITING_INPUT: 'Awaiting Input',
KANBAN_COL_NEEDS_ATTENTION: 'Needs Attention',
KANBAN_COL_COMPLETED: 'Completed',
/** Kanban board empty column placeholder */
KANBAN_EMPTY_COLUMN: 'No sessions',
/** Toggle button tooltips */
KANBAN_TOGGLE_BOARD: 'Switch to board view',
KANBAN_TOGGLE_LIST: 'Switch to list view',
```

**Step 3: Commit**

```bash
git add webview-ui/src/store/dashboardStore.ts webview-ui/src/config/strings.ts
git commit -m "feat(kanban): add store state and string constants"
```

---

### Task 2: Test and add store `overviewMode`

**Files:**
- Modify: `src/__tests__/DashboardStore.test.ts`

**Step 1: Write tests for overviewMode**

Follow the existing `activeTab` test pattern (lines 53-78 of DashboardStore.test.ts):

```typescript
describe('DashboardStore — overviewMode', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes overviewMode as "list"', () => {
    expect(useDashboardStore.getState().overviewMode).toBe('list');
  });

  it('setOverviewMode switches to "board"', () => {
    useDashboardStore.getState().setOverviewMode('board');
    expect(useDashboardStore.getState().overviewMode).toBe('board');
  });

  it('setOverviewMode switches back to "list"', () => {
    useDashboardStore.getState().setOverviewMode('board');
    useDashboardStore.getState().setOverviewMode('list');
    expect(useDashboardStore.getState().overviewMode).toBe('list');
  });

  it('clearFocus does not reset overviewMode', () => {
    useDashboardStore.getState().setOverviewMode('board');
    useDashboardStore.getState().clearFocus();
    expect(useDashboardStore.getState().overviewMode).toBe('board');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/__tests__/DashboardStore.test.ts`
Expected: All pass (new tests + existing tests)

**Step 3: Commit**

```bash
git add src/__tests__/DashboardStore.test.ts
git commit -m "test(kanban): add overviewMode store tests"
```

---

### Task 3: Extract `getContextText` to shared utility

The `getContextText` function in `OverviewCard.tsx` (lines 34-80) is needed by both `OverviewCard` and the new `KanbanCard`. Extract it to avoid duplication.

**Files:**
- Create: `webview-ui/src/utils/sessionContext.ts`
- Modify: `webview-ui/src/components/OverviewCard.tsx`

**Step 1: Create `sessionContext.ts`**

```typescript
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES } from '@shared/sharedConstants';
import { timeAgo } from './formatters';
import { UI_STRINGS } from '../config/strings';

/**
 * Returns a short context string describing what the session is currently doing.
 * Used by OverviewCard and KanbanCard for the secondary text line.
 */
export function getContextText(session: SessionInfo): string {
  switch (session.status) {
    case SESSION_STATUSES.WORKING:
      if (session.lastToolName) {
        return session.lastToolInput
          ? `${session.lastToolName} — ${session.lastToolInput}`
          : session.lastToolName;
      }
      return UI_STRINGS.CONTEXT_WORKING;
    case SESSION_STATUSES.THINKING:
      return UI_STRINGS.CONTEXT_THINKING;
    case SESSION_STATUSES.WAITING:
      if (session.pendingQuestion?.isToolApproval) {
        const tools = session.pendingQuestion.pendingTools;
        if (tools && tools.length > 0) {
          const desc = tools
            .map((t) => (t.inputSummary ? `${t.toolName} — ${t.inputSummary}` : t.toolName))
            .join(', ');
          const maxLen = 80; // inline-ok: matches TRUNCATION.TOOL_APPROVAL_DESC_MAX
          const truncated = desc.length > maxLen ? desc.substring(0, maxLen) + '...' : desc;
          return `${UI_STRINGS.CONTEXT_TOOL_APPROVAL}: ${truncated}`;
        }
        return UI_STRINGS.CONTEXT_TOOL_APPROVAL;
      }
      if (session.pendingQuestion?.isPlanApproval) {
        return session.pendingQuestion.planMode === 'enter'
          ? UI_STRINGS.CONTEXT_ENTER_PLAN_APPROVAL
          : UI_STRINGS.CONTEXT_EXIT_PLAN_APPROVAL;
      }
      return session.pendingQuestion
        ? session.pendingQuestion.question.length > 80
          ? session.pendingQuestion.question.substring(0, 80) + '...'
          : session.pendingQuestion.question
        : UI_STRINGS.CONTEXT_WAITING;
    case SESSION_STATUSES.ERROR:
      return UI_STRINGS.CONTEXT_ERROR;
    case SESSION_STATUSES.DONE:
      if (session.lastAssistantText) {
        return session.lastAssistantText;
      }
      return `${UI_STRINGS.CONTEXT_DONE} — ${timeAgo(session.lastActivityAt)}`;
    case SESSION_STATUSES.IDLE:
      return timeAgo(session.lastActivityAt);
    default:
      return '';
  }
}
```

**Step 2: Update `OverviewCard.tsx` to import from shared utility**

Remove the local `getContextText` function (lines 34-80) and add import:

```typescript
import { getContextText } from '../utils/sessionContext';
```

**Step 3: Run build to verify no regressions**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add webview-ui/src/utils/sessionContext.ts webview-ui/src/components/OverviewCard.tsx
git commit -m "refactor: extract getContextText to shared utility for reuse"
```

---

### Task 4: Test `getContextText`

**Files:**
- Create: `src/__tests__/sessionContext.test.ts`

**Step 1: Write tests**

Follow the formatters test pattern. Use `vi.useFakeTimers()` for time-dependent branches.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getContextText } from '../../webview-ui/src/utils/sessionContext';
import type { SessionInfo } from '../../src/models/types';

/** Minimal SessionInfo factory for tests. */
function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'test-session',
    slug: 'test',
    summary: '',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    gitBranch: 'main',
    cwd: '/tmp',
    startedAt: '2026-02-25T12:00:00Z',
    lastActivityAt: '2026-02-25T12:00:00Z',
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    isArtifact: false,
    filePath: '/tmp/test.jsonl',
    ...overrides,
  };
}

describe('getContextText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns tool name + input for working status with tool', () => {
    const session = makeSession({
      status: 'working',
      lastToolName: 'Read',
      lastToolInput: 'src/index.ts',
    });
    expect(getContextText(session)).toBe('Read — src/index.ts');
  });

  it('returns tool name alone for working status with tool but no input', () => {
    const session = makeSession({
      status: 'working',
      lastToolName: 'Bash',
    });
    expect(getContextText(session)).toBe('Bash');
  });

  it('returns fallback for working status with no tool', () => {
    const session = makeSession({ status: 'working' });
    expect(getContextText(session)).toBe('Working...');
  });

  it('returns thinking text for thinking status', () => {
    const session = makeSession({ status: 'thinking' });
    expect(getContextText(session)).toBe('Thinking...');
  });

  it('returns question text for waiting with pendingQuestion', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: 'Which approach?',
        options: [],
        multiSelect: false,
      },
    });
    expect(getContextText(session)).toBe('Which approach?');
  });

  it('truncates long question text at 80 chars', () => {
    const longQuestion = 'A'.repeat(100);
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: longQuestion,
        options: [],
        multiSelect: false,
      },
    });
    const result = getContextText(session);
    expect(result).toBe('A'.repeat(80) + '...');
  });

  it('returns tool approval text for waiting with tool approval', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: '',
        options: [],
        multiSelect: false,
        isToolApproval: true,
        pendingTools: [{ toolName: 'Bash', inputSummary: 'npm test' }],
      },
    });
    expect(getContextText(session)).toContain('Waiting for tool approval');
    expect(getContextText(session)).toContain('Bash — npm test');
  });

  it('returns plan approval text for enter plan mode', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: '',
        options: [],
        multiSelect: false,
        isPlanApproval: true,
        planMode: 'enter',
      },
    });
    expect(getContextText(session)).toBe('Asking to enter plan mode');
  });

  it('returns plan approval text for exit plan mode', () => {
    const session = makeSession({
      status: 'waiting',
      pendingQuestion: {
        question: '',
        options: [],
        multiSelect: false,
        isPlanApproval: true,
        planMode: 'exit',
      },
    });
    expect(getContextText(session)).toBe('Plan ready for approval');
  });

  it('returns error text for error status', () => {
    const session = makeSession({ status: 'error' });
    expect(getContextText(session)).toContain('Stuck');
  });

  it('returns lastAssistantText for done status when available', () => {
    const session = makeSession({
      status: 'done',
      lastAssistantText: 'Here is the result',
    });
    expect(getContextText(session)).toBe('Here is the result');
  });

  it('returns time ago for done status without lastAssistantText', () => {
    const session = makeSession({
      status: 'done',
      lastActivityAt: '2026-02-25T11:55:00Z',
    });
    expect(getContextText(session)).toContain('5m ago');
  });

  it('returns time ago for idle status', () => {
    const session = makeSession({
      status: 'idle',
      lastActivityAt: '2026-02-25T11:00:00Z',
    });
    expect(getContextText(session)).toBe('1h ago');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/__tests__/sessionContext.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/__tests__/sessionContext.test.ts
git commit -m "test(kanban): add getContextText tests"
```

---

### Task 5: Create `KanbanCard` component

**Files:**
- Create: `webview-ui/src/components/KanbanCard.tsx`

**Step 1: Create the component**

Key differences from original plan:
- Added context menu support (onRename, onHide, onUnhide, isHiddenTab props)
- `getContextText` assigned to local variable (avoids double-call)
- Hover state drives styles declaratively via `isHovered` state
- Uses `SESSION_STATUSES.WORKING` constant instead of `'working'` string literal

```typescript
import React, { useState } from 'react';
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES, STATUS_GROUPS } from '@shared/sharedConstants';
import { StatusDot } from './StatusDot';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { getContextText } from '../utils/sessionContext';
import { timeAgo, formatCostCompact, getSessionDisplayName } from '../utils/formatters';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';

interface KanbanCardProps {
  session: SessionInfo;
  isSelected: boolean;
  cost: number;
  borderColor: string;
  onClick: () => void;
  onDoubleClick: () => void;
  onRename: (sessionId: string, name: string) => void;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
}

export function KanbanCard({
  session,
  isSelected,
  cost,
  borderColor,
  onClick,
  onDoubleClick,
  onRename,
  onHide,
  onUnhide,
  isHiddenTab,
}: KanbanCardProps): React.ReactElement {
  const isActive = STATUS_GROUPS.ACTIVE.has(session.status);
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextText = getContextText(session);

  const contextMenuItems: ContextMenuItem[] = isHiddenTab
    ? [
        ...(onUnhide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_UNHIDE, action: () => onUnhide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => onRename(session.sessionId, getSessionDisplayName(session)),
        },
      ]
    : [
        ...(onHide
          ? [{ label: UI_STRINGS.CONTEXT_MENU_HIDE, action: () => onHide(session.sessionId) }]
          : []),
        {
          label: UI_STRINGS.CONTEXT_MENU_RENAME,
          action: () => onRename(session.sessionId, getSessionDisplayName(session)),
        },
      ];

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        padding: '8px 10px', // inline-ok
        cursor: 'pointer',
        backgroundColor: isSelected
          ? COLORS.SELECTED_CARD_BG
          : isHovered
            ? COLORS.HOVER_CARD_BG
            : 'var(--bg-card)',
        borderLeft: `2px solid ${borderColor}`,
        borderTop: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRight: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderBottom: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: '4px', // inline-ok
        transition: 'background-color 0.1s, border-color 0.1s',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px', // inline-ok
        minWidth: 0,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Row 1: StatusDot + session name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          minWidth: 0,
        }}
      >
        <StatusDot status={session.status} size={6} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px', // inline-ok
            fontWeight: 700,
            color: 'var(--fg-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={getSessionDisplayName(session)}
        >
          {getSessionDisplayName(session)}
        </span>
      </div>

      {/* Row 2: Context text */}
      <div
        style={{
          fontSize: '10px', // inline-ok
          color: isActive ? 'var(--fg-primary)' : 'var(--fg-secondary)',
          fontFamily: session.status === SESSION_STATUSES.WORKING ? 'var(--font-mono)' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={contextText}
      >
        {contextText}
      </div>

      {/* Row 3: Cost + time ago */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          fontSize: '9px', // inline-ok
          color: 'var(--fg-muted)',
        }}
      >
        {cost > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)' }}>{formatCostCompact(cost)}</span>
        )}
        <span style={{ flex: 1 }} />
        <span>{timeAgo(session.lastActivityAt)}</span>
      </div>
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add webview-ui/src/components/KanbanCard.tsx
git commit -m "feat(kanban): add KanbanCard component with context menu"
```

---

### Task 6: Create `KanbanColumn` component

**Files:**
- Create: `webview-ui/src/components/KanbanColumn.tsx`

**Step 1: Create the component**

Props now include context menu handlers passed through to KanbanCard.

```typescript
import React from 'react';
import type { SessionInfo } from '@shared/types';
import { KanbanCard } from './KanbanCard';
import { UI_STRINGS } from '../config/strings';

interface KanbanColumnProps {
  label: string;
  sessions: SessionInfo[];
  borderColor: string;
  focusedSessionId: string | null;
  costBySession: Map<string, number>;
  onSessionClick: (sessionId: string) => void;
  onSessionDoubleClick: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
}

export function KanbanColumn({
  label,
  sessions,
  borderColor,
  focusedSessionId,
  costBySession,
  onSessionClick,
  onSessionDoubleClick,
  onRename,
  onHide,
  onUnhide,
  isHiddenTab,
}: KanbanColumnProps): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        minWidth: '120px', // inline-ok: minimum column width before horizontal scroll
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Column header */}
      <div
        style={{
          padding: '6px 8px', // inline-ok
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          borderBottom: `2px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '11px', // inline-ok
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px', // inline-ok
            color: borderColor,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: '10px', // inline-ok
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ({sessions.length})
        </span>
      </div>

      {/* Card list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '6px 4px', // inline-ok
          display: 'flex',
          flexDirection: 'column',
          gap: '4px', // inline-ok
          minHeight: 0,
        }}
      >
        {sessions.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-lg)',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: '10px', // inline-ok
              opacity: 0.6, // inline-ok
            }}
          >
            {UI_STRINGS.KANBAN_EMPTY_COLUMN}
          </div>
        ) : (
          sessions.map((session) => (
            <KanbanCard
              key={session.sessionId}
              session={session}
              isSelected={focusedSessionId === session.sessionId}
              cost={costBySession.get(session.sessionId) || 0}
              borderColor={borderColor}
              onClick={() => onSessionClick(session.sessionId)}
              onDoubleClick={() => onSessionDoubleClick(session.sessionId)}
              onRename={onRename}
              onHide={onHide}
              onUnhide={onUnhide}
              isHiddenTab={isHiddenTab}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add webview-ui/src/components/KanbanColumn.tsx
git commit -m "feat(kanban): add KanbanColumn component"
```

---

### Task 7: Create `KanbanBoard` component

**Files:**
- Create: `webview-ui/src/components/KanbanBoard.tsx`

Key differences from original plan:
- No COLORS imports for border colors — uses `var(${STATUS_CONFIG[status].cssVar})` pattern directly
- Fallback: sessions with unrecognized status go to "completed" column
- `costBySession` received as prop (not computed internally — avoids duplication with OverviewPanel)
- Context menu handlers passed through

**Step 1: Create the component**

```typescript
import React, { useMemo } from 'react';
import type { SessionInfo, SessionStatus } from '@shared/types';
import { SESSION_STATUSES } from '@shared/sharedConstants';
import { STATUS_CONFIG } from '../config/statusConfig';
import { KanbanColumn } from './KanbanColumn';
import { UI_STRINGS } from '../config/strings';

/** Column definition for the Kanban board. */
interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly statuses: ReadonlySet<SessionStatus>;
  readonly cssVar: string;
}

/** Kanban column definitions — order determines left-to-right rendering. */
const COLUMNS: readonly ColumnDef[] = [
  {
    key: 'performing',
    label: UI_STRINGS.KANBAN_COL_PERFORMING,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.WORKING, SESSION_STATUSES.THINKING]),
    cssVar: STATUS_CONFIG.working.cssVar,
  },
  {
    key: 'awaiting',
    label: UI_STRINGS.KANBAN_COL_AWAITING_INPUT,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.WAITING]),
    cssVar: STATUS_CONFIG.waiting.cssVar,
  },
  {
    key: 'error',
    label: UI_STRINGS.KANBAN_COL_NEEDS_ATTENTION,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.ERROR]),
    cssVar: STATUS_CONFIG.error.cssVar,
  },
  {
    key: 'completed',
    label: UI_STRINGS.KANBAN_COL_COMPLETED,
    statuses: new Set<SessionStatus>([SESSION_STATUSES.DONE, SESSION_STATUSES.IDLE]),
    cssVar: STATUS_CONFIG.done.cssVar,
  },
];

/** Index of the fallback column for sessions with unrecognized status. */
const FALLBACK_COLUMN_INDEX = COLUMNS.length - 1; // inline-ok: completed column

interface KanbanBoardProps {
  sessions: SessionInfo[];
  costBySession: Map<string, number>;
  focusedSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onSessionDoubleClick: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onHide?: (sessionId: string) => void;
  onUnhide?: (sessionId: string) => void;
  isHiddenTab?: boolean;
}

/**
 * Groups sessions into Kanban columns by status.
 * Sessions with unrecognized status fall into the last column (Completed).
 */
export function groupSessionsByColumn(sessions: readonly SessionInfo[]): Map<string, SessionInfo[]> {
  const result = new Map<string, SessionInfo[]>();
  for (const col of COLUMNS) {
    result.set(col.key, []);
  }
  for (const session of sessions) {
    let placed = false;
    for (const col of COLUMNS) {
      if (col.statuses.has(session.status)) {
        result.get(col.key)!.push(session);
        placed = true;
        break;
      }
    }
    if (!placed) {
      result.get(COLUMNS[FALLBACK_COLUMN_INDEX].key)!.push(session);
    }
  }
  return result;
}

export function KanbanBoard({
  sessions,
  costBySession,
  focusedSessionId,
  onSessionClick,
  onSessionDoubleClick,
  onRename,
  onHide,
  onUnhide,
  isHiddenTab,
}: KanbanBoardProps): React.ReactElement {
  const grouped = useMemo(() => groupSessionsByColumn(sessions), [sessions]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        gap: '4px', // inline-ok
        overflow: 'hidden',
        minHeight: 0,
        padding: '0 var(--spacing-sm) var(--spacing-sm)', // inline-ok
      }}
    >
      {COLUMNS.map((col) => (
        <KanbanColumn
          key={col.key}
          label={col.label}
          sessions={grouped.get(col.key) || []}
          borderColor={`var(${col.cssVar})`}
          focusedSessionId={focusedSessionId}
          costBySession={costBySession}
          onSessionClick={onSessionClick}
          onSessionDoubleClick={onSessionDoubleClick}
          onRename={onRename}
          onHide={onHide}
          onUnhide={onUnhide}
          isHiddenTab={isHiddenTab}
        />
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add webview-ui/src/components/KanbanBoard.tsx
git commit -m "feat(kanban): add KanbanBoard container with fallback grouping"
```

---

### Task 8: Test `groupSessionsByColumn`

**Files:**
- Create: `src/__tests__/KanbanBoard.test.ts`

**Step 1: Write tests for the exported grouping function**

```typescript
import { describe, it, expect } from 'vitest';
import { groupSessionsByColumn } from '../../webview-ui/src/components/KanbanBoard';
import type { SessionInfo } from '../../src/models/types';

function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'test-session',
    slug: 'test',
    summary: '',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    gitBranch: 'main',
    cwd: '/tmp',
    startedAt: '2026-02-25T12:00:00Z',
    lastActivityAt: '2026-02-25T12:00:00Z',
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    isArtifact: false,
    filePath: '/tmp/test.jsonl',
    ...overrides,
  };
}

describe('groupSessionsByColumn', () => {
  it('groups working sessions into performing column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'working' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['a']);
    expect(result.get('awaiting')!).toHaveLength(0);
    expect(result.get('error')!).toHaveLength(0);
    expect(result.get('completed')!).toHaveLength(0);
  });

  it('groups thinking sessions into performing column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'thinking' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('groups waiting sessions into awaiting column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'waiting' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('awaiting')!.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('groups error sessions into error column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'error' })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('error')!.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('groups done and idle sessions into completed column', () => {
    const sessions = [
      makeSession({ sessionId: 'a', status: 'done' }),
      makeSession({ sessionId: 'b', status: 'idle' }),
    ];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['a', 'b']);
  });

  it('distributes mixed sessions to correct columns', () => {
    const sessions = [
      makeSession({ sessionId: 'a', status: 'working' }),
      makeSession({ sessionId: 'b', status: 'waiting' }),
      makeSession({ sessionId: 'c', status: 'error' }),
      makeSession({ sessionId: 'd', status: 'done' }),
      makeSession({ sessionId: 'e', status: 'thinking' }),
    ];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('performing')!.map((s) => s.sessionId)).toEqual(['a', 'e']);
    expect(result.get('awaiting')!.map((s) => s.sessionId)).toEqual(['b']);
    expect(result.get('error')!.map((s) => s.sessionId)).toEqual(['c']);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['d']);
  });

  it('returns empty arrays for all columns when no sessions', () => {
    const result = groupSessionsByColumn([]);
    expect(result.get('performing')!).toHaveLength(0);
    expect(result.get('awaiting')!).toHaveLength(0);
    expect(result.get('error')!).toHaveLength(0);
    expect(result.get('completed')!).toHaveLength(0);
  });

  it('places sessions with unrecognized status in completed (fallback) column', () => {
    const sessions = [makeSession({ sessionId: 'a', status: 'unknown' as any })];
    const result = groupSessionsByColumn(sessions);
    expect(result.get('completed')!.map((s) => s.sessionId)).toEqual(['a']);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/__tests__/KanbanBoard.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/__tests__/KanbanBoard.test.ts
git commit -m "test(kanban): add groupSessionsByColumn tests with fallback"
```

---

### Task 9: Wire up `OverviewPanel` with view toggle

**Files:**
- Modify: `webview-ui/src/components/OverviewPanel.tsx`

Key differences from original plan:
- Toggle button is outside the scrollable area (sticky header)
- `costBySession` computed once in OverviewPanel, passed to both OverviewCard and KanbanBoard
- Context menu handlers passed through to KanbanBoard

**Step 1: Add the toggle button and conditional rendering**

Update `OverviewPanel.tsx`:

- Add imports:
```typescript
import { useDashboardStore, OVERVIEW_MODES } from '../store/dashboardStore';
import { KanbanBoard } from './KanbanBoard';
```

- Read store state inside the component:
```typescript
const overviewMode = useDashboardStore((s) => s.overviewMode);
const setOverviewMode = useDashboardStore((s) => s.setOverviewMode);
```

- Restructure the outer div to have two children: a sticky toggle bar and a scrollable content area. The outer div becomes a flex column:

```typescript
return (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}
  >
    {/* Sticky toggle bar — outside scroll area */}
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '4px var(--spacing-sm) 0', // inline-ok
        flexShrink: 0,
      }}
    >
      <button
        onClick={() =>
          setOverviewMode(
            overviewMode === OVERVIEW_MODES.LIST ? OVERVIEW_MODES.BOARD : OVERVIEW_MODES.LIST
          )
        }
        title={
          overviewMode === OVERVIEW_MODES.LIST
            ? UI_STRINGS.KANBAN_TOGGLE_BOARD
            : UI_STRINGS.KANBAN_TOGGLE_LIST
        }
        aria-label={
          overviewMode === OVERVIEW_MODES.LIST
            ? UI_STRINGS.KANBAN_TOGGLE_BOARD
            : UI_STRINGS.KANBAN_TOGGLE_LIST
        }
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--fg-muted)',
          fontSize: '14px', // inline-ok
          padding: '2px 6px', // inline-ok
          borderRadius: '3px', // inline-ok
        }}
      >
        {overviewMode === OVERVIEW_MODES.LIST ? '\u2637' : '\u2630'}
      </button>
    </div>

    {/* Content area */}
    {sessions.length === 0 ? (
      <div style={{ /* existing empty state styles */ }}>
        {/* existing empty state content — unchanged */}
      </div>
    ) : overviewMode === OVERVIEW_MODES.BOARD ? (
      <KanbanBoard
        sessions={sessions}
        costBySession={costBySession}
        focusedSessionId={focusedSessionId}
        onSessionClick={onSessionClick}
        onSessionDoubleClick={onSessionDoubleClick}
        onRename={onRename}
        onHide={onHide}
        onUnhide={onUnhide}
        isHiddenTab={isHiddenTab}
      />
    ) : (
      <div style={{ /* existing scrollable list styles */ }}>
        {/* existing grid with drag-reorder — unchanged */}
      </div>
    )}
  </div>
);
```

The `costBySession` Map (currently built at lines 35-38) is already in scope and gets passed to `KanbanBoard` as a prop instead of being rebuilt inside KanbanBoard.

**Step 2: Run build to verify**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add webview-ui/src/components/OverviewPanel.tsx
git commit -m "feat(kanban): wire up board view toggle in OverviewPanel"
```

---

### Task 10: Build and manual verification

**Step 1: Run all tests**

Run: `npm run test`
Expected: All pass (new tests + existing tests)

**Step 2: Full build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 3: Type check**

Run: `npm run lint`
Expected: No type errors

**Step 4: Manual test checklist**

Press F5 to launch Extension Development Host, then:

- [ ] Default view is list mode (no behavior change)
- [ ] Toggle button appears above session list, does not scroll with content
- [ ] Clicking toggle switches to board view with 4 columns
- [ ] Sessions appear in correct columns by status
- [ ] Column headers show label + count in status color
- [ ] Empty columns show "No sessions" placeholder
- [ ] Clicking a card opens split view with detail panel
- [ ] Double-clicking a card expands to full detail
- [ ] Right-click shows context menu with Hide/Rename options
- [ ] Toggle back to list mode works, preserves focused session
- [ ] Search filtering applies to board view
- [ ] Hidden tab board view works (Unhide instead of Hide in context menu)

**Step 5: Commit any fixes if needed**
