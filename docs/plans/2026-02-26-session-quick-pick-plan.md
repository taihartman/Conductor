# Session Quick Pick Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `Cmd+Shift+;` keybinding that opens a VS Code Quick Pick listing all visible sessions sorted by urgency, and focuses the selected session in the Conductor dashboard.

**Architecture:** A new `conductor.quickPickSession` command reads sessions from `SessionTracker`, filters out hidden/sub-agent/artifact sessions, sorts by urgency, and presents them via `vscode.window.showQuickPick()`. Selection calls a new `DashboardPanel.focusSession()` public method, which updates internal state and sends a new `session:focus-command` IPC message so the webview syncs its selection. The command handler lives in a new `src/commands/` directory.

**Tech Stack:** VS Code Extension API (`QuickPick`, `QuickPickItem`, `QuickPickItemKind`), TypeScript, Vitest

**Design doc:** `docs/plans/2026-02-26-session-quick-pick-design.md`

---

### Task 1: Add constants

**Files:**
- Modify: `src/constants.ts:11-15` (COMMANDS object)
- Modify: `src/constants.ts:18-32` (LOG_PREFIX object)

**Step 1: Add `QUICK_PICK_SESSION` to `COMMANDS`**

In `src/constants.ts`, add to the `COMMANDS` object:

```typescript
export const COMMANDS = {
  OPEN: 'conductor.open',
  REFRESH: 'conductor.refresh',
  LAUNCH_SESSION: 'conductor.launchSession',
  QUICK_PICK_SESSION: 'conductor.quickPickSession',
} as const;
```

**Step 2: Add `QUICK_PICK` to `LOG_PREFIX`**

In `src/constants.ts`, add to the `LOG_PREFIX` object:

```typescript
  AUTO_RECONNECT: '[Conductor:AutoReconnect]',
  QUICK_PICK: '[Conductor:QuickPick]',
} as const;
```

**Step 3: Add `QUICK_PICK_STRINGS` constant for user-visible strings**

Add a new constant object at the bottom of `src/constants.ts` (before the re-exports):

```typescript
/** User-visible strings for the Quick Pick session switcher. */
export const QUICK_PICK_STRINGS = {
  /** Placeholder text shown in the Quick Pick input. */
  PLACEHOLDER: 'Switch to session...',
  /** Shown when no sessions are available. */
  NO_SESSIONS: 'No active sessions found',
} as const;
```

**Step 4: Verify the file compiles**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: No errors

**Step 5: Commit**

```bash
git add src/constants.ts
git commit -m "feat(quick-pick): add command ID, log prefix, and UI strings constants"
```

---

### Task 2: Add `session:focus-command` IPC message to protocol

**Files:**
- Modify: `src/models/protocol.ts:35-61` (ExtensionToWebviewMessage union)

**Step 1: Add the new message variant**

In `src/models/protocol.ts`, add to the `ExtensionToWebviewMessage` union after the `launch-mode:current` entry (line 61):

```typescript
  /** Persisted launch mode preference pushed to the webview on `ready`. */
  | { type: 'launch-mode:current'; mode: LaunchMode }
  /** Extension-initiated session focus (e.g. from Quick Pick). Webview should update its selection. */
  | { type: 'session:focus-command'; sessionId: string };
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/models/protocol.ts
git commit -m "feat(quick-pick): add session:focus-command IPC message type"
```

---

### Task 3: Add `focusSession()` public method to DashboardPanel

**Files:**
- Modify: `src/DashboardPanel.ts:192-214` (after postFullState, add new public method)

**Step 1: Add the `focusSession` method**

In `src/DashboardPanel.ts`, add after `postFullState()` (after line 214):

```typescript
  /**
   * Programmatically focus a session from the extension side.
   *
   * @remarks
   * Sets the focused session, sends filtered activities/conversation to the webview,
   * and notifies the webview to update its selection state via `session:focus-command`.
   * Used by the Quick Pick session switcher.
   *
   * @param sessionId - The session ID to focus
   */
  public focusSession(sessionId: string): void {
    console.log(`${LOG_PREFIX.PANEL} Focusing session from extension: ${sessionId}`);
    this.focusedSessionId = sessionId;
    this.postActivities();
    this.postConversation();
    this.postMessage({ type: 'session:focus-command', sessionId });
  }
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/DashboardPanel.ts
git commit -m "feat(quick-pick): add public focusSession() method to DashboardPanel"
```

---

### Task 4: Handle `session:focus-command` in webview

**Files:**
- Modify: `webview-ui/src/hooks/useVsCodeMessage.ts:5-17` (destructuring)
- Modify: `webview-ui/src/hooks/useVsCodeMessage.ts:23-65` (switch cases)
- Modify: `webview-ui/src/hooks/useVsCodeMessage.ts:70-81` (deps array)

**Step 1: Add `setFocusedSession` to the destructured store actions**

In `useVsCodeMessage.ts`, add `setFocusedSession` to the destructured object (line 6-17):

```typescript
  const {
    setFullState,
    setActivities,
    setConversation,
    setInputStatus,
    appendPtyBuffer,
    setPtyBuffers,
    setPendingLaunchSession,
    removePendingAdoption,
    setViewMode,
    setAutoHidePatterns,
    setFocusedSession,
  } = useDashboardStore();
```

**Step 2: Add the message handler case**

Add a new case in the switch statement (after the `settings:current` case, before the closing `}`):

```typescript
        case 'settings:current':
          setAutoHidePatterns(message.autoHidePatterns);
          break;
        case 'session:focus-command':
          setFocusedSession(message.sessionId);
          break;
```

**Step 3: Add `setFocusedSession` to the deps array**

Add `setFocusedSession` to the useEffect dependency array:

```typescript
  ], [
    setFullState,
    setActivities,
    setConversation,
    setInputStatus,
    appendPtyBuffer,
    setPtyBuffers,
    setPendingLaunchSession,
    removePendingAdoption,
    setViewMode,
    setAutoHidePatterns,
    setFocusedSession,
  ]);
```

**Step 4: Verify the webview compiles**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add webview-ui/src/hooks/useVsCodeMessage.ts
git commit -m "feat(quick-pick): handle session:focus-command in webview message hook"
```

---

### Task 5: Register command and keybinding in package.json

**Files:**
- Modify: `package.json:32-45` (contributes.commands)
- Modify: `package.json` (add contributes.keybindings section)

**Step 1: Add the command entry**

In `package.json`, add to the `contributes.commands` array:

```json
      {
        "command": "conductor.quickPickSession",
        "title": "Conductor: Switch Session"
      }
```

**Step 2: Add the keybindings section**

In `package.json`, add a `keybindings` array to the `contributes` object (after `configuration`):

```json
    "keybindings": [
      {
        "command": "conductor.quickPickSession",
        "key": "ctrl+shift+;",
        "mac": "cmd+shift+;"
      }
    ]
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat(quick-pick): register command and Cmd+Shift+; keybinding"
```

---

### Task 6: Write tests for quickPickSession

**Files:**
- Create: `src/__tests__/quickPickSession.test.ts`

**Step 1: Write the test file**

Create `src/__tests__/quickPickSession.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode');

import { buildQuickPickItems, sortSessionsByUrgency, resolveDisplayName, relativeTime } from '../commands/quickPickSession';
import type { SessionInfo } from '../models/types';

/** Helper to create a minimal SessionInfo for testing. */
function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'sess-1',
    slug: 'abc123',
    summary: '',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    autoName: undefined,
    customName: undefined,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
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

describe('sortSessionsByUrgency', () => {
  it('sorts waiting before active before done before idle', () => {
    const sessions = [
      makeSession({ sessionId: 'idle-1', status: 'idle' }),
      makeSession({ sessionId: 'working-1', status: 'working' }),
      makeSession({ sessionId: 'waiting-1', status: 'waiting' }),
      makeSession({ sessionId: 'done-1', status: 'done' }),
      makeSession({ sessionId: 'error-1', status: 'error' }),
      makeSession({ sessionId: 'thinking-1', status: 'thinking' }),
    ];

    const sorted = sortSessionsByUrgency(sessions);
    const ids = sorted.map((s) => s.sessionId);

    expect(ids).toEqual([
      'waiting-1',
      'error-1',
      'working-1',
      'thinking-1',
      'done-1',
      'idle-1',
    ]);
  });

  it('sorts by most recent activity within same status group', () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date().toISOString();
    const sessions = [
      makeSession({ sessionId: 'old', status: 'waiting', lastActivityAt: older }),
      makeSession({ sessionId: 'new', status: 'waiting', lastActivityAt: newer }),
    ];

    const sorted = sortSessionsByUrgency(sessions);
    expect(sorted[0].sessionId).toBe('new');
    expect(sorted[1].sessionId).toBe('old');
  });
});

describe('resolveDisplayName', () => {
  it('prefers customName over autoName', () => {
    const session = makeSession({ customName: 'My Session', autoName: 'auto-name' });
    expect(resolveDisplayName(session)).toBe('My Session');
  });

  it('falls back to autoName when no customName', () => {
    const session = makeSession({ autoName: 'auto-name' });
    expect(resolveDisplayName(session)).toBe('auto-name');
  });

  it('falls back to sessionId when neither name exists', () => {
    const session = makeSession({ sessionId: 'sess-xyz' });
    expect(resolveDisplayName(session)).toBe('sess-xyz');
  });
});

describe('relativeTime', () => {
  it('formats seconds', () => {
    const t = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(t)).toBe('30s');
  });

  it('formats minutes', () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(t)).toBe('5m');
  });

  it('formats hours', () => {
    const t = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(relativeTime(t)).toBe('2h');
  });

  it('formats days', () => {
    const t = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(relativeTime(t)).toBe('3d');
  });
});

describe('buildQuickPickItems', () => {
  it('returns no-sessions message when empty', () => {
    const items = buildQuickPickItems([]);
    expect(items).toHaveLength(1);
    expect(items[0].label).toContain('No active sessions found');
  });

  it('includes status icon in label', () => {
    const sessions = [makeSession({ status: 'waiting', autoName: 'my-app' })];
    const items = buildQuickPickItems(sessions);
    expect(items[0].label).toContain('$(bell)');
    expect(items[0].label).toContain('my-app');
  });

  it('inserts separator items between status groups', () => {
    const sessions = sortSessionsByUrgency([
      makeSession({ sessionId: 's1', status: 'waiting' }),
      makeSession({ sessionId: 's2', status: 'working' }),
    ]);
    const items = buildQuickPickItems(sessions);
    // Should have: 1 waiting item, 1 separator, 1 active item
    const separators = items.filter((i) => (i as any).kind === -1);
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });

  it('stores sessionId in item for selection lookup', () => {
    const sessions = [makeSession({ sessionId: 'pick-me', status: 'idle', autoName: 'test' })];
    const items = buildQuickPickItems(sessions);
    const pickable = items.filter((i) => (i as any).sessionId);
    expect(pickable).toHaveLength(1);
    expect((pickable[0] as any).sessionId).toBe('pick-me');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/quickPickSession.test.ts`
Expected: FAIL — `../commands/quickPickSession` module not found

**Step 3: Commit**

```bash
git add src/__tests__/quickPickSession.test.ts
git commit -m "test(quick-pick): add failing tests for session sorting, display names, and Quick Pick items"
```

---

### Task 7: Implement quickPickSession command handler

**Files:**
- Create: `src/commands/quickPickSession.ts`

**Step 1: Create the `src/commands/` directory and implementation file**

Create `src/commands/quickPickSession.ts`:

```typescript
/**
 * @module quickPickSession
 *
 * Command handler for `conductor.quickPickSession` — opens a VS Code Quick Pick
 * listing all visible sessions sorted by urgency.
 */

import * as vscode from 'vscode';
import type { SessionTracker } from '../monitoring/SessionTracker';
import type { SessionInfo, SessionStatus } from '../models/types';
import { DashboardPanel } from '../DashboardPanel';
import { LOG_PREFIX, QUICK_PICK_STRINGS } from '../constants';
import type { ISessionNameStore } from '../persistence/ISessionNameStore';
import type { ISessionVisibilityStore } from '../persistence/ISessionVisibilityStore';

// ── Status urgency priority ──────────────────────────────────────────────

/** Priority order: lower number = higher urgency. */
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  error: 1,
  working: 2,
  thinking: 3,
  done: 4,
  idle: 5,
};

/** Codicon icon per status. */
const STATUS_ICON: Record<SessionStatus, string> = {
  waiting: '$(bell)',
  error: '$(alert)',
  working: '$(pulse)',
  thinking: '$(pulse)',
  done: '$(check)',
  idle: '$(circle-filled)',
};

/** Human-readable group labels for separators. */
const STATUS_GROUP_LABEL: Record<SessionStatus, string> = {
  waiting: 'Waiting',
  error: 'Error',
  working: 'Active',
  thinking: 'Active',
  done: 'Done',
  idle: 'Idle',
};

// ── Quick Pick item type ─────────────────────────────────────────────────

interface SessionQuickPickItem extends vscode.QuickPickItem {
  sessionId?: string;
}

// ── Exported helpers (tested directly) ───────────────────────────────────

/** Sort sessions by urgency priority, then by most recent activity within each group. */
export function sortSessionsByUrgency(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) return priorityDiff;
    // Within same priority: most recent first
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

/** Resolve the display name for a session: customName > autoName > sessionId. */
export function resolveDisplayName(session: SessionInfo): string {
  return session.customName || session.autoName || session.sessionId;
}

/** Format an ISO timestamp as a compact relative time string (e.g. `3m`, `1h`). */
export function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Build Quick Pick items from sorted sessions, inserting separators between status groups. */
export function buildQuickPickItems(sessions: SessionInfo[]): SessionQuickPickItem[] {
  if (sessions.length === 0) {
    return [{ label: QUICK_PICK_STRINGS.NO_SESSIONS }];
  }

  const items: SessionQuickPickItem[] = [];
  let lastGroupLabel: string | undefined;

  for (const session of sessions) {
    const groupLabel = STATUS_GROUP_LABEL[session.status];
    if (groupLabel !== lastGroupLabel) {
      items.push({
        label: groupLabel,
        kind: vscode.QuickPickItemKind.Separator,
      });
      lastGroupLabel = groupLabel;
    }

    const icon = STATUS_ICON[session.status];
    const name = resolveDisplayName(session);
    const time = relativeTime(session.lastActivityAt);

    items.push({
      label: `${icon}  ${name}`,
      description: `${session.status} ${time}`,
      sessionId: session.sessionId,
    });
  }

  return items;
}

// ── Command handler ──────────────────────────────────────────────────────

/**
 * Show the session Quick Pick and focus the selected session.
 *
 * @param context - Extension context (for opening the dashboard if needed)
 * @param sessionTracker - Reads current session state
 * @param nameStore - Resolves custom display names
 * @param visibilityStore - Filters out hidden sessions
 * @param createOrShowDeps - Remaining deps needed by DashboardPanel.createOrShow
 */
export async function quickPickSession(
  context: vscode.ExtensionContext,
  sessionTracker: SessionTracker,
  nameStore: ISessionNameStore,
  visibilityStore: ISessionVisibilityStore,
  createOrShowDeps: {
    orderStore: import('../persistence/ISessionOrderStore').ISessionOrderStore;
    sessionLauncher: import('../terminal/ISessionLauncher').ISessionLauncher;
    ptyBridge: import('../terminal/IPtyBridge').IPtyBridge;
    launchedSessionStore: import('../persistence/ILaunchedSessionStore').ILaunchedSessionStore;
  }
): Promise<void> {
  console.log(`${LOG_PREFIX.QUICK_PICK} Opening session Quick Pick`);

  // 1. Get all sessions
  const state = sessionTracker.getState(null);
  const hiddenIds = visibilityStore.getHiddenIds();
  const forceShownIds = visibilityStore.getForceShownIds();

  // 2. Filter: exclude hidden, sub-agents, artifacts
  const visible = state.sessions.filter((s) => {
    if (s.isSubAgent) return false;
    if (hiddenIds.has(s.sessionId)) return false;
    if (s.isArtifact && !forceShownIds.has(s.sessionId)) return false;
    return true;
  });

  // 3. Apply custom names
  const named = visible.map((s) => {
    const customName = nameStore.getName(s.sessionId);
    return customName ? { ...s, customName } : s;
  });

  // 4. Sort by urgency
  const sorted = sortSessionsByUrgency(named);

  // 5. Build Quick Pick items
  const items = buildQuickPickItems(sorted);

  // 6. Show Quick Pick
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: QUICK_PICK_STRINGS.PLACEHOLDER,
    matchOnDescription: true,
  });

  if (!selected?.sessionId) {
    console.log(`${LOG_PREFIX.QUICK_PICK} Quick Pick dismissed`);
    return;
  }

  console.log(`${LOG_PREFIX.QUICK_PICK} Selected session: ${selected.sessionId}`);

  // 7. Open dashboard if not visible, then focus
  const panel = DashboardPanel.createOrShow(
    context,
    sessionTracker,
    nameStore,
    createOrShowDeps.orderStore,
    visibilityStore,
    createOrShowDeps.sessionLauncher,
    createOrShowDeps.ptyBridge,
    createOrShowDeps.launchedSessionStore
  );
  panel.focusSession(selected.sessionId);
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/quickPickSession.test.ts`
Expected: All tests PASS

**Step 3: Run type check**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: No errors

**Step 4: Commit**

```bash
git add src/commands/quickPickSession.ts
git commit -m "feat(quick-pick): implement session Quick Pick command handler with urgency sorting"
```

---

### Task 8: Register command in extension.ts

**Files:**
- Modify: `src/extension.ts:1-18` (imports)
- Modify: `src/extension.ts:99-101` (command registration)

**Step 1: Add import**

Add to the imports in `src/extension.ts`:

```typescript
import { quickPickSession } from './commands/quickPickSession';
```

**Step 2: Register the command**

After the `launchCommand` registration (line 99) and before the `context.subscriptions.push` line (line 101), add the Quick Pick command:

```typescript
  const quickPickCommand = vscode.commands.registerCommand(COMMANDS.QUICK_PICK_SESSION, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Quick Pick session command invoked`);
    quickPickSession(context, sessionTracker!, nameStore, visibilityStore, {
      orderStore,
      sessionLauncher,
      ptyBridge,
      launchedSessionStore,
    }).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.EXTENSION} Quick Pick failed: ${err}`);
    });
  });
```

**Step 3: Add to subscriptions**

Update the `context.subscriptions.push` line to include the new command:

```typescript
  context.subscriptions.push(openCommand, refreshCommand, launchCommand, quickPickCommand);
```

**Step 4: Run type check**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: No errors

**Step 5: Run full test suite**

Run: `npm run test`
Expected: All tests PASS (including new Quick Pick tests)

**Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat(quick-pick): register quickPickSession command in extension activation"
```

---

### Task 9: Build and manual verification

**Step 1: Build the full extension**

Run: `npm run build`
Expected: Clean build, no errors

**Step 2: Run full lint**

Run: `npm run lint:all`
Expected: No errors

**Step 3: Run all tests**

Run: `npm run test`
Expected: All tests pass

**Step 4: Manual smoke test**

Press F5 in VS Code to launch the extension host. Then:
1. Open a workspace that has Claude sessions
2. Press `Cmd+Shift+;`
3. Verify the Quick Pick appears with session names, status icons, and separators
4. Select a session and verify the Conductor dashboard opens with that session focused
5. Press `Cmd+Shift+;` again and dismiss with Escape — verify no errors

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(quick-pick): address any issues from manual testing"
```
