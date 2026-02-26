# Link Launched Session to Conductor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After launching a Claude session from Conductor, the session appears in the dashboard within seconds and auto-focuses.

**Architecture:** A polling refresh on DashboardPanel discovers the JSONL file Claude creates (500ms intervals, max 10s). The FileSystemWatcher should detect it instantly, but the poll is a safety net for platforms where FS events are unreliable. The webview auto-focuses via `pendingLaunchSessionId` state in the Zustand store — set on `session:launch-status`, consumed atomically inside `setFullState`. Both launch paths (webview button and command palette) route through the same `DashboardPanel.notifySessionLaunched()` method — no duplication.

**Tech Stack:** TypeScript, VS Code Extension API, Zustand, Vitest

---

## Context

The `SessionLauncher` now uses `shellPath`/`shellArgs` to create a real PTY terminal. Claude's TUI renders and JSONL transcript files get created. But the Conductor dashboard doesn't know about the launched session until the `TranscriptWatcher` discovers the JSONL file (up to 30s via periodic scan, or ~instant via FileSystemWatcher).

### Key files to understand before starting

| File | What it does |
|------|-------------|
| `src/DashboardPanel.ts:319-340` | `session:launch` handler — calls `sessionLauncher.launch()`, registers PtyBridge, posts status |
| `src/DashboardPanel.ts:512-519` | `dispose()` — clears panel and disposables. Must also clear any polling timer |
| `src/extension.ts:69-81` | `COMMANDS.LAUNCH_SESSION` handler — same flow but from command palette |
| `src/monitoring/SessionTracker.ts:256-270` | `refresh()` — scans for new JSONL files, adds untracked sessions |
| `src/constants.ts:104-113` | `TIMING` object — where timing constants live |
| `webview-ui/src/hooks/useVsCodeMessage.ts:35-38` | `session:launch-status` handler — currently a no-op |
| `webview-ui/src/store/dashboardStore.ts:104-105` | `setFullState` — will gain auto-focus logic |
| `src/__tests__/DashboardStore.test.ts` | Existing store tests — pattern to follow |

---

### Task 1: Add timing constants

**Files:**
- Modify: `src/constants.ts:104-113`

**Step 1: Add the constants**

In `src/constants.ts`, add two entries to the existing `TIMING` object:

```typescript
export const TIMING = {
  /**
   * Fallback delay before marking a text-only turn as done when neither
   * `stop_hook_summary` nor `turn_duration` system records arrive.
   */
  INTERMISSION_MS: 5_000,
  /**
   * Interval for polling after a session launch to discover the JSONL file.
   * The FileSystemWatcher usually detects it faster, but this poll is a
   * safety net for platforms where FS events are unreliable.
   */
  LAUNCH_DISCOVERY_POLL_MS: 500,
  /** Maximum number of poll attempts before giving up (500ms * 20 = 10s). */
  LAUNCH_DISCOVERY_MAX_RETRIES: 20,
} as const;
```

**Step 2: Verify types**

Run: `npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add launch discovery polling constants"
```

---

### Task 2: Add `pendingLaunchSessionId` + auto-focus in store

The auto-focus logic lives inside `setFullState` so it's atomic (one render, no stale reads).

**Files:**
- Modify: `webview-ui/src/store/dashboardStore.ts`
- Test: `src/__tests__/DashboardStore.test.ts`

**Step 1: Write the failing tests**

Add a new `describe` block to `src/__tests__/DashboardStore.test.ts`:

```typescript
describe('DashboardStore — pendingLaunchSessionId', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes pendingLaunchSessionId as null', () => {
    expect(useDashboardStore.getState().pendingLaunchSessionId).toBeNull();
  });

  it('setPendingLaunchSession stores the session ID', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    expect(useDashboardStore.getState().pendingLaunchSessionId).toBe('abc-123');
  });

  it('setFullState auto-focuses when pending session appears', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    useDashboardStore.getState().setFullState(
      [{ sessionId: 'abc-123' } as any],
      [], [], [], []
    );
    const state = useDashboardStore.getState();
    expect(state.focusedSessionId).toBe('abc-123');
    expect(state.pendingLaunchSessionId).toBeNull();
  });

  it('setFullState does not auto-focus when pending session is absent', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    useDashboardStore.getState().setFullState(
      [{ sessionId: 'other-session' } as any],
      [], [], [], []
    );
    const state = useDashboardStore.getState();
    expect(state.focusedSessionId).toBeNull();
    expect(state.pendingLaunchSessionId).toBe('abc-123');
  });

  it('setFullState does not auto-focus when no pending session', () => {
    useDashboardStore.getState().setFullState(
      [{ sessionId: 'abc-123' } as any],
      [], [], [], []
    );
    expect(useDashboardStore.getState().focusedSessionId).toBeNull();
  });

  it('setPendingLaunchSession(null) clears pending', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    useDashboardStore.getState().setPendingLaunchSession(null);
    expect(useDashboardStore.getState().pendingLaunchSessionId).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/DashboardStore.test.ts`
Expected: FAIL — `pendingLaunchSessionId` and `setPendingLaunchSession` don't exist yet.

**Step 3: Implement the store changes**

In `webview-ui/src/store/dashboardStore.ts`:

Add to the `DashboardState` interface (after `activeTab` line ~52):

```typescript
/** Session ID from a Conductor-initiated launch, awaiting appearance in state:full. */
pendingLaunchSessionId: string | null;
setPendingLaunchSession: (sessionId: string | null) => void;
```

Initialize in the store (after `activeTab: 'sessions'` line ~102):

```typescript
pendingLaunchSessionId: null,
```

Add the action (after `setActiveTab`):

```typescript
setPendingLaunchSession: (sessionId) => set({ pendingLaunchSessionId: sessionId }),
```

Update `setFullState` (line ~104) to check for auto-focus atomically:

```typescript
setFullState: (sessions, activities, conversation, toolStats, tokenSummaries) =>
  set((state) => {
    const pending = state.pendingLaunchSessionId;
    const found = pending !== null && sessions.some((s) => s.sessionId === pending);
    return {
      sessions,
      activities,
      conversation,
      toolStats,
      tokenSummaries,
      ...(found
        ? {
            focusedSessionId: pending,
            detailViewMode: DETAIL_VIEW_MODES.SPLIT,
            filteredSubAgentId: null,
            pendingLaunchSessionId: null,
          }
        : {}),
    };
  }),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/DashboardStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add webview-ui/src/store/dashboardStore.ts src/__tests__/DashboardStore.test.ts
git commit -m "feat: add pendingLaunchSessionId with atomic auto-focus in setFullState"
```

---

### Task 3: Handle `session:launch-status` in useVsCodeMessage

**Files:**
- Modify: `webview-ui/src/hooks/useVsCodeMessage.ts`

**Step 1: Update the hook**

Add `setPendingLaunchSession` to the destructured store actions:

```typescript
const { setFullState, setActivities, setConversation, setInputStatus, appendPtyBuffer, setPendingLaunchSession } =
  useDashboardStore();
```

Update the `session:launch-status` case:

```typescript
case 'session:launch-status':
  if (message.status === 'launched' && message.sessionId) {
    setPendingLaunchSession(message.sessionId);
  } else if (message.status === 'error') {
    setPendingLaunchSession(null);
  }
  break;
```

Add `setPendingLaunchSession` to the `useEffect` dependency array.

**Step 2: Verify types**

Run: `npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add webview-ui/src/hooks/useVsCodeMessage.ts
git commit -m "feat: set pendingLaunchSessionId on session:launch-status"
```

---

### Task 4: Add polling refresh + disposal to DashboardPanel

This is the core extension-side change. A single `notifySessionLaunched()` public method handles both launch paths (webview button and command palette). The polling timer is tracked and cleared on disposal.

**Files:**
- Modify: `src/DashboardPanel.ts`

**Step 1: Add TIMING import**

Update the import from `../constants`:

```typescript
import { PANEL_TITLE, LOG_PREFIX, TIMING } from '../constants';
```

**Step 2: Add timer field**

Add a private field to DashboardPanel (after `private lastSessionIdSet: string = '';` around line 48):

```typescript
private launchDiscoveryTimer: ReturnType<typeof setInterval> | undefined;
```

**Step 3: Add `notifySessionLaunched()` public method**

Add after `postFullState()` (around line 197):

```typescript
/**
 * Notify the panel that a session was launched (from either the webview or command palette).
 * Posts launch-status to the webview and starts polling for the JSONL file.
 */
public notifySessionLaunched(sessionId: string): void {
  this.ptyBridge.registerSession(sessionId);
  this.postMessage({
    type: 'session:launch-status',
    sessionId,
    status: 'launched',
  });
  this.startLaunchDiscoveryPoll(sessionId);
}
```

**Step 4: Add private polling method**

```typescript
private startLaunchDiscoveryPoll(sessionId: string): void {
  this.clearLaunchDiscoveryTimer();
  let retries = 0;
  this.launchDiscoveryTimer = setInterval(() => {
    this.sessionTracker.refresh();
    const found = this.sessionTracker
      .getState(null)
      .sessions.some((s) => s.sessionId === sessionId);
    if (found || ++retries >= TIMING.LAUNCH_DISCOVERY_MAX_RETRIES) {
      this.clearLaunchDiscoveryTimer();
    }
    this.postFullState();
  }, TIMING.LAUNCH_DISCOVERY_POLL_MS);
}

private clearLaunchDiscoveryTimer(): void {
  if (this.launchDiscoveryTimer !== undefined) {
    clearInterval(this.launchDiscoveryTimer);
    this.launchDiscoveryTimer = undefined;
  }
}
```

**Step 5: Update the `session:launch` handler to use `notifySessionLaunched`**

Replace the existing `session:launch` case:

```typescript
case 'session:launch': {
  console.log(`${LOG_PREFIX.PANEL} Launching new session`);
  this.sessionLauncher
    .launch(message.cwd)
    .then((sessionId) => {
      console.log(`${LOG_PREFIX.PANEL} Session launched: ${sessionId}`);
      this.notifySessionLaunched(sessionId);
    })
    .catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to launch session: ${err}`);
      this.postMessage({
        type: 'session:launch-status',
        status: 'error',
        error: String(err),
      });
    });
  break;
}
```

**Step 6: Update `dispose()` to clear the timer**

In `dispose()` (line 512), add timer cleanup before the existing logic:

```typescript
dispose(): void {
  this.clearLaunchDiscoveryTimer();
  DashboardPanel.currentPanel = undefined;
  this.panel.dispose();
  while (this.disposables.length) {
    const d = this.disposables.pop();
    d?.dispose();
  }
}
```

**Step 7: Verify types**

Run: `npm run lint`
Expected: PASS

**Step 8: Commit**

```bash
git add src/DashboardPanel.ts
git commit -m "feat: add polling refresh with disposal after session launch"
```

---

### Task 5: Route command palette launch through DashboardPanel

The `extension.ts` command handler should delegate to `DashboardPanel.notifySessionLaunched()` instead of duplicating logic. If the panel isn't open, there's no webview to show the session — the watcher will pick it up naturally.

**Files:**
- Modify: `src/extension.ts:69-81`

**Step 1: Update the LAUNCH_SESSION handler**

```typescript
const launchCommand = vscode.commands.registerCommand(COMMANDS.LAUNCH_SESSION, () => {
  console.log(`${LOG_PREFIX.EXTENSION} Launch session command invoked`);
  sessionLauncher
    .launch()
    .then((sessionId) => {
      console.log(`${LOG_PREFIX.EXTENSION} Session launched: ${sessionId}`);
      // Delegate to DashboardPanel if open — it handles PtyBridge, status, and polling
      DashboardPanel.currentPanel?.notifySessionLaunched(sessionId);
    })
    .catch((err: unknown) => {
      console.log(`${LOG_PREFIX.EXTENSION} Failed to launch session: ${err}`);
      vscode.window.showErrorMessage(`Failed to launch Claude session: ${err}`);
    });
});
```

Note: `ptyBridge.registerSession(sessionId)` is removed from here — `notifySessionLaunched()` already calls it. If the panel is closed, PtyBridge registration is skipped (no webview to replay data into anyway).

**Step 2: Verify types**

Run: `npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: route command palette launch through DashboardPanel"
```

---

### Task 6: Verification

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests pass.

Run: `npm run lint`
Expected: PASS

**Step 2: Manual verification**

1. Press F5 to launch the extension host
2. Open Conductor (`Cmd+Shift+P` → "Conductor: Open Dashboard")
3. Click the launch session button
4. Verify:
   - A "Claude (Conductor)" terminal tab appears immediately
   - Claude's REPL renders in the terminal (interactive TUI)
   - Within a few seconds, the session appears in the Conductor session list
   - The session auto-focuses (detail panel shows activities/conversation)
5. Type a message in the Claude terminal
6. Verify: Conductor shows the activity updating in real-time
7. Test command palette path: `Cmd+Shift+P` → "Conductor: Launch Session"
8. Verify same behavior as step 4

**Step 3: Commit (if any adjustments were needed)**

---

### Task 7: Clean up debug trace logs

**Files:**
- Check all `src/` and `webview-ui/src/` files

**Step 1: Search for debug trace remnants**

Run: `grep -rn "DEBUG-TRACE" src/ webview-ui/src/`

If any are found, remove the lines. The SessionLauncher was rewritten (no debug traces remain), and DashboardPanel debug traces were already removed. This step is a safety check.

**Step 2: Commit if needed**

```bash
git commit -m "chore: remove debug trace logs"
```
