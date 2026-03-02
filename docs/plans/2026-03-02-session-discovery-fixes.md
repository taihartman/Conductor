# Session Discovery Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two related bugs: (1) extension auto-scopes to the open workspace and hides all other Claude sessions, and (2) the empty state always says "Monitoring ~/.claude/projects/" regardless of what's actually being watched.

**Architecture:** Two independent changes. First, `SessionTracker.resolveProjectDirs()` is simplified to only use the explicit `conductor.additionalWorkspaces` setting for scoping — the implicit current-workspace scoping is removed entirely so users see all their sessions by default. Second, `SessionTracker` gains a `getMonitoringScope()` method that returns the actual monitored path(s) as a human-readable string; this is threaded through the `state:full` IPC message into the Zustand store and rendered dynamically in `EmptyState`.

**Tech Stack:** TypeScript, Vitest, Zustand 5, React 19, VS Code extension API

---

## Background for the implementer

### How scoping works today (the bug)

`SessionTracker` constructor accepts a `workspacePath` (the first VS Code workspace folder). `resolveProjectDirs()` uses it to find the matching Claude project dir under `~/.claude/projects/`. If there's any workspace open, the extension only watches that workspace's sessions. This means installing the extension in project A and opening it there shows nothing if you've been running Claude in project B.

### What we're changing

- Remove `workspacePath` from `SessionTracker.resolveProjectDirs()`. The extension is now always **unscoped** (shows all `~/.claude/projects/`) unless the user explicitly configures `conductor.additionalWorkspaces`.
- `conductor.additionalWorkspaces` stays as-is — it becomes the *only* way to scope.
- `workspacePath` is kept as a parameter in the constructor signature (ignored, prefixed with `_`) so `extension.ts` call sites don't need changes in this PR.
- `extension.ts:218` still needs updating: `updateScope(workspacePath)` → `updateScope()` because the method now takes no arguments.

### `getMonitoringScope()` contract

The method returns a **path-like string** for display in the UI. Three cases:

1. **Unscoped** (`scopedProjectDirs === undefined`): returns `~/.claude/projects/`
2. **Scoped to specific dirs** (`scopedProjectDirs.length > 0`): returns comma-separated home-relative paths, e.g. `~/.claude/projects/-home-user-myproject/`
3. **Scoped but empty** (`scopedProjectDirs.length === 0`): returns `~/.claude/projects/ (no workspace matches)` — a path-like string that includes a hint. The user has configured `additionalWorkspaces` but no matching project dir was found yet.

### Key files

| File | Purpose |
|---|---|
| `src/monitoring/SessionTracker.ts` | Core state machine — owns `resolveProjectDirs()` and scope retry |
| `src/extension.ts` | Activation — `updateScope(workspacePath)` call at line 218 needs updating |
| `src/models/protocol.ts` | IPC message types (discriminated union, add field here) |
| `src/DashboardPanel.ts` | IPC bridge — calls `postFullState()` which sends `state:full` |
| `webview-ui/src/store/dashboardStore.ts` | Zustand store — `setFullState` signature |
| `webview-ui/src/hooks/useVsCodeMessage.ts` | Handles incoming IPC messages |
| `webview-ui/src/config/strings.ts` | UI string constants — remove hardcoded monitoring path, add default constant |
| `webview-ui/src/components/EmptyState.tsx` | Renders when no sessions found |
| `src/__tests__/SessionTracker.test.ts` | Existing scoping tests to update — **6 tests break**, see Task 1 |
| `src/__tests__/DashboardPanel.test.ts` | `createMockSessionTracker()` missing `getMonitoringScope` — see Task 4 |
| `src/__tests__/DashboardStore.test.ts` | **10 `setFullState` call sites** — handled by making param optional, see Task 3 |

### Running tests

```bash
# All tests
npm run test

# Single file
npx vitest run src/__tests__/SessionTracker.test.ts

# Watch mode
npm run test:watch
```

---

## Task 1: Remove workspace auto-scoping (SessionTracker)

**Files:**
- Modify: `src/monitoring/SessionTracker.ts`
- Modify: `src/extension.ts`
- Modify: `src/__tests__/SessionTracker.test.ts`

### Step 1: Run the existing scoping tests first — note which ones pass

Before touching any code, see the current baseline:

```bash
npx vitest run src/__tests__/SessionTracker.test.ts --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗)" | tail -30
```

Note the output. The following tests will **break** after our change and need to be rewritten:

**In `describe('SessionTracker scope retry')`** (lines 899–993):
- `starts scope retry when scoped-but-empty` (line 916) — uses `new SessionTracker(outputChannel, '/nonexistent/workspace')`
- `retry discovers the dir and restarts watcher` (line 937) — same
- `retry stops after success` (line 963) — same
- `dispose cleans up the retry timer` (line 982) — same

**In `describe('SessionTracker scoping semantics')`** (lines 995–1057):
- `resolveProjectDirs returns [] when workspace provided but dir does not exist` (line 1018) — same
- `refresh scans nothing when scoped but empty` (line 1026) — same

### Step 2: Rewrite the 6 affected tests

All 6 tests trigger the scoped-but-empty path by passing `/nonexistent/workspace` to the constructor. After our change, the constructor ignores `workspacePath`, so these tests will no longer produce the scoped-but-empty state. Rewrite them to use `mockGetConfiguration` to configure `conductor.additionalWorkspaces` instead.

**In `describe('SessionTracker scope retry')`**, replace the 4 broken tests:

```typescript
// BEFORE — triggers scoped-but-empty via workspace path
it('starts scope retry when scoped-but-empty', () => {
  const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
  // ...

// AFTER — triggers scoped-but-empty via additionalWorkspaces config
it('starts scope retry when scoped-but-empty', () => {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => {
      if (key === 'conductor.additionalWorkspaces') return ['/nonexistent/workspace'];
      return defaultValue ?? [];
    },
  });
  const tracker = new SessionTracker(outputChannel);
  tracker.start();
  const t = tracker as any;

  expect(t.scopeRetryTimer).toBeDefined();

  tracker.dispose();
});

it('retry discovers the dir and restarts watcher', () => {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => {
      if (key === 'conductor.additionalWorkspaces') return ['/nonexistent/workspace'];
      return defaultValue ?? [];
    },
  });
  const tracker = new SessionTracker(outputChannel);
  tracker.start();
  const t = tracker as any;

  const oldWatcher = t.watcher;
  const disposeSpy = vi.spyOn(oldWatcher, 'dispose');

  // Initially scoped but empty
  expect(t.scopedProjectDirs).toEqual([]);

  // Mock scanner to simulate the dir appearing
  const resolvedDir = '/home/user/.claude/projects/-nonexistent-workspace';
  vi.spyOn(t.scanner, 'getProjectDirForWorkspace').mockReturnValue(resolvedDir);

  // Advance past the retry interval (30s)
  vi.advanceTimersByTime(30_000);

  expect(disposeSpy).toHaveBeenCalled();
  expect(t.watcher).not.toBe(oldWatcher);
  expect(t.scopedProjectDirs).toEqual([resolvedDir]);

  tracker.dispose();
});

it('retry stops after success', () => {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => {
      if (key === 'conductor.additionalWorkspaces') return ['/nonexistent/workspace'];
      return defaultValue ?? [];
    },
  });
  const tracker = new SessionTracker(outputChannel);
  tracker.start();
  const t = tracker as any;

  expect(t.scopeRetryTimer).toBeDefined();

  vi.spyOn(t.scanner, 'getProjectDirForWorkspace').mockReturnValue('/fake/dir');

  vi.advanceTimersByTime(30_000);

  expect(t.scopeRetryTimer).toBeUndefined();

  tracker.dispose();
});

it('dispose cleans up the retry timer', () => {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => {
      if (key === 'conductor.additionalWorkspaces') return ['/nonexistent/workspace'];
      return defaultValue ?? [];
    },
  });
  const tracker = new SessionTracker(outputChannel);
  tracker.start();
  const t = tracker as any;

  expect(t.scopeRetryTimer).toBeDefined();

  tracker.dispose();

  expect(t.scopeRetryTimer).toBeUndefined();
});
```

**In `describe('SessionTracker scoping semantics')`**, replace the 2 broken tests:

```typescript
// REPLACE this test:
it('resolveProjectDirs returns [] when workspace provided but dir does not exist', () => {
  // ...old: new SessionTracker(outputChannel, '/nonexistent/workspace')

// WITH:
it('resolveProjectDirs returns undefined when workspace arg is provided but additionalWorkspaces is empty', () => {
  // After fix: workspacePath is ignored; no additionalWorkspaces → unscoped
  const tracker = new SessionTracker(outputChannel, '/some/workspace');
  const t = tracker as any;
  expect(t.scopedProjectDirs).toBeUndefined();
  tracker.dispose();
});

it('resolveProjectDirs returns [] when additionalWorkspaces is configured but no matching dir', () => {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => {
      if (key === 'conductor.additionalWorkspaces') return ['/nonexistent'];
      return defaultValue ?? [];
    },
  });
  const tracker = new SessionTracker(outputChannel);
  const t = tracker as any;
  // Scoped (additionalWorkspaces set) but empty (dir doesn't exist)
  expect(t.scopedProjectDirs).toEqual([]);
  tracker.dispose();
});

// REPLACE this test:
it('refresh scans nothing when scoped but empty', () => {
  // ...old: new SessionTracker(outputChannel, '/nonexistent/workspace')

// WITH:
it('refresh scans nothing when scoped but empty', () => {
  mockGetConfiguration.mockReturnValue({
    get: (key: string, defaultValue?: unknown) => {
      if (key === 'conductor.additionalWorkspaces') return ['/nonexistent'];
      return defaultValue ?? [];
    },
  });
  const tracker = new SessionTracker(outputChannel);
  const t = tracker as any;

  const scanSpy = vi.spyOn(t.scanner, 'scanSessionFiles');
  scanSpy.mockReturnValue([]);

  tracker.refresh();

  expect(scanSpy).toHaveBeenCalledWith([], expect.any(Number));

  scanSpy.mockRestore();
  tracker.dispose();
});
```

### Step 3: Run the rewritten tests to verify they still fail (implementation not done yet)

```bash
npx vitest run src/__tests__/SessionTracker.test.ts --reporter=verbose 2>&1 | grep -E "(FAIL|✗)" | head -20
```

Expected: The 6 rewritten tests still fail (or some pass for the wrong reasons).

### Step 4: Update `resolveProjectDirs()` in SessionTracker

In `src/monitoring/SessionTracker.ts`, find `resolveProjectDirs` (around line 223). Replace the entire method with:

```typescript
/**
 * Resolve project directories to watch based on `conductor.additionalWorkspaces`.
 *
 * @remarks
 * Returns `undefined` (unscoped — watch all projects) unless the user has
 * explicitly configured `conductor.additionalWorkspaces`. The previous
 * implicit scoping to the current VS Code workspace has been removed: users
 * should see all their Claude sessions by default.
 *
 * Return value contract:
 * - `undefined` — unscoped; watch everything under ~/.claude/projects/
 * - `string[]` with length > 0 — scoped to these specific directories
 * - `string[]` with length === 0 — scoped, but no matching dirs found yet
 *   (additionalWorkspaces is configured but dirs don't exist on disk)
 *
 * @returns `undefined` when unscoped, `string[]` when scoped (may be empty)
 */
private resolveProjectDirs(): string[] | undefined {
  const additionalPaths =
    vscode.workspace.getConfiguration().get<string[]>(SETTINGS.ADDITIONAL_WORKSPACES, []) ?? [];

  // No additional workspaces configured → unscoped (show all Claude sessions)
  if (additionalPaths.length === 0) {
    return undefined;
  }

  // additionalWorkspaces configured → scope to only those directories
  const paths: string[] = [];
  for (const p of additionalPaths) {
    const dir = this.scanner.getProjectDirForWorkspace(p);
    if (dir) {
      paths.push(dir);
    } else {
      const msg = `Additional workspace path "${p}" has no matching Claude Code project directory — skipping`;
      console.log(`${LOG_PREFIX.SESSION_TRACKER} ${msg}`);
      this.outputChannel.appendLine(msg);
    }
  }

  return [...new Set(paths)];
}
```

### Step 5: Update the constructor and `workspacePath` field

Find the `SessionTracker` constructor (around line 205). Change the `workspacePath` parameter to `_workspacePath` (ignored) and update the `resolveProjectDirs` call:

```typescript
// Change field declaration:
// private readonly workspacePath: string | undefined;
// → delete this field entirely

// Change constructor signature + body:
constructor(
  outputChannel: vscode.OutputChannel,
  _workspacePath?: string,   // kept for call-site compatibility; ignored
  nameResolver?: ISessionNameResolver
) {
  this.outputChannel = outputChannel;
  this.scanner = new ProjectScanner();
  this.nameResolver = nameResolver ?? new SessionNameResolver();
  this.scopedProjectDirs = this.resolveProjectDirs();  // no arg now
}
```

### Step 6: Update `updateScope()` and the `scopeRetry` callback

Find `updateScope` (around line 601). Change it to take no arguments:

```typescript
updateScope(): void {
  const newDirs = this.resolveProjectDirs();
  // ... rest of body unchanged, was already using newDirs ...
}
```

Find the `scopeRetry` timer callback (search for `resolveProjectDirs(this.workspacePath)`). Change it to:

```typescript
const newDirs = this.resolveProjectDirs();
```

Delete the `private readonly workspacePath` field declaration.

### Step 7: Update `extension.ts` line 218

In `src/extension.ts`, find line 218:

```typescript
// BEFORE:
sessionTracker?.updateScope(workspacePath);

// AFTER:
sessionTracker?.updateScope();
```

### Step 8: Run the tests to verify they all pass

```bash
npx vitest run src/__tests__/SessionTracker.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

### Step 9: Commit

```bash
git add src/monitoring/SessionTracker.ts src/extension.ts src/__tests__/SessionTracker.test.ts
git commit -m "fix: remove workspace auto-scoping — show all sessions by default

Previously the extension would scope to only the current VS Code workspace,
hiding sessions from all other projects. Now unscoped by default;
conductor.additionalWorkspaces is the only way to scope.

Also fix extension.ts:218 — updateScope() now takes no arguments."
```

---

## Task 2: Add `getMonitoringScope()` to SessionTracker

**Files:**
- Modify: `src/monitoring/SessionTracker.ts`
- Modify: `src/__tests__/SessionTracker.test.ts`

### Step 1: Write the failing tests

In `src/__tests__/SessionTracker.test.ts`, add a new `describe` block after the existing scoping tests:

```typescript
describe('getMonitoringScope', () => {
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
  });

  afterEach(() => {
    mockGetConfiguration.mockReset();
  });

  it('returns home-relative path to projects dir when unscoped', () => {
    const tracker = new SessionTracker(outputChannel);
    const scope = tracker.getMonitoringScope();
    expect(scope).toBe('~/.claude/projects/');
    tracker.dispose();
  });

  it('returns scoped dir paths when additionalWorkspaces resolves to dirs', () => {
    // We need scanner.getProjectDirForWorkspace to return something.
    // The easiest way is to patch the scanner after construction.
    const tracker = new SessionTracker(outputChannel);
    const t = tracker as any;

    // Pretend a dir was resolved
    t.scopedProjectDirs = ['/home/user/.claude/projects/-home-user-myapp'];
    const scope = tracker.getMonitoringScope();
    expect(scope).toBe('~/.claude/projects/-home-user-myapp');
    tracker.dispose();
  });

  it('returns path-like string when scoped but no matching dirs', () => {
    mockGetConfiguration.mockReturnValue({
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'conductor.additionalWorkspaces') return ['/nonexistent'];
        return defaultValue ?? [];
      },
    });
    const tracker = new SessionTracker(outputChannel);
    const scope = tracker.getMonitoringScope();
    // Scoped but empty — should return path-like string ending with hint
    expect(scope).toContain('~/.claude/projects/');
    expect(scope).toContain('no workspace matches');
    tracker.dispose();
  });
});
```

### Step 2: Run to verify failure

```bash
npx vitest run src/__tests__/SessionTracker.test.ts --reporter=verbose 2>&1 | grep -A 3 "getMonitoringScope"
```

Expected: FAIL — method doesn't exist yet.

### Step 3: Implement `getMonitoringScope()`

Add this public method to `SessionTracker` (after `getState()`). Add `import * as os from 'os';` at the top of the file if not already present.

```typescript
/**
 * Return a human-readable string describing what directories are being monitored.
 * Used by the webview empty state to help users diagnose detection issues.
 *
 * Contract (three cases):
 * 1. Unscoped (scopedProjectDirs === undefined): returns '~/.claude/projects/'
 * 2. Scoped and found (scopedProjectDirs.length > 0): returns comma-separated
 *    home-relative paths, e.g. '~/.claude/projects/-home-user-myapp/'
 * 3. Scoped but empty (scopedProjectDirs.length === 0): returns
 *    '~/.claude/projects/ (no workspace matches)' — signals that
 *    additionalWorkspaces is configured but no matching project dir was found
 *
 * @returns A displayable string always suitable for showing in the UI
 */
public getMonitoringScope(): string {
  const home = os.homedir();
  const projectsDir = this.scanner.getProjectsDir().replace(home, '~');

  if (this.scopedProjectDirs === undefined) {
    // Unscoped — watching everything under ~/.claude/projects/
    return `${projectsDir}/`;
  }
  if (this.scopedProjectDirs.length === 0) {
    // Scoped but empty — additionalWorkspaces configured but no dirs found yet
    return `${projectsDir}/ (no workspace matches)`;
  }
  // Scoped to specific dirs
  return this.scopedProjectDirs.map((d) => d.replace(home, '~')).join(', ');
}
```

### Step 4: Run tests to verify pass

```bash
npx vitest run src/__tests__/SessionTracker.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: PASS.

### Step 5: Commit

```bash
git add src/monitoring/SessionTracker.ts src/__tests__/SessionTracker.test.ts
git commit -m "feat: add getMonitoringScope() to SessionTracker for diagnostic display"
```

---

## Task 3: Thread `monitoringScope` through IPC into the Zustand store

**Files:**
- Modify: `src/models/protocol.ts`
- Modify: `webview-ui/src/config/strings.ts`
- Modify: `webview-ui/src/store/dashboardStore.ts`
- Modify: `webview-ui/src/hooks/useVsCodeMessage.ts`

> **Important:** `setFullState` currently has 7 positional parameters. There are **10 call sites in `src/__tests__/DashboardStore.test.ts`** that pass exactly 7 args. Adding an 8th required parameter would break them all. To avoid that, make `monitoringScope` **optional with a constant default**.

### Step 1: Add `DEFAULT_MONITORING_SCOPE` constant to strings.ts

In `webview-ui/src/config/strings.ts`, replace the `EMPTY_STATE_MONITORING` line:

```typescript
// REMOVE this line:
EMPTY_STATE_MONITORING: 'Monitoring ~/.claude/projects/',
```

Add a standalone named export (outside `UI_STRINGS` — it's a default value, not a UI label):

```typescript
/**
 * Default monitoring scope shown in the empty state before the first state:full
 * message arrives from the extension, and used as the default for setFullState.
 */
export const DEFAULT_MONITORING_SCOPE = '~/.claude/projects/' as const;
```

### Step 2: Add `monitoringScope` to the `state:full` protocol message

In `src/models/protocol.ts`, find the `state:full` union member and add one field:

```typescript
| {
    type: 'state:full';
    sessions: SessionInfo[];
    activities: ActivityEvent[];
    conversation: ConversationTurn[];
    toolStats: ToolStatEntry[];
    tokenSummaries: TokenSummary[];
    isNestedSession: boolean;
    focusedSessionId: string | null;
    /** Human-readable description of which directories are being monitored for sessions. */
    monitoringScope: string;
  }
```

### Step 3: Add `monitoringScope` to the Zustand store

In `webview-ui/src/store/dashboardStore.ts`, add the import at the top:

```typescript
import { DEFAULT_MONITORING_SCOPE } from '../config/strings';
```

Find the `DashboardState` interface and add:

```typescript
/** Human-readable description of which directories are monitored for sessions. */
monitoringScope: string;
```

Find the `setFullState` method signature and add an **optional** 8th parameter with a default:

```typescript
setFullState: (
  sessions: SessionInfo[],
  activities: ActivityEvent[],
  conversation: ConversationTurn[],
  toolStats: ToolStatEntry[],
  tokenSummaries: TokenSummary[],
  isNestedSession: boolean,
  focusedSessionId: string | null,
  monitoringScope?: string   // optional — existing tests pass 7 args and get the default
) => void;
```

Find the `setFullState` implementation in the `create(...)` call. Update the implementation signature to:

```typescript
setFullState: (sessions, activities, conversation, toolStats, tokenSummaries, isNestedSession, focusedSessionId, monitoringScope = DEFAULT_MONITORING_SCOPE) =>
  set((state) => ({
    // ... all existing fields unchanged ...
    monitoringScope,
  })),
```

Add `monitoringScope` to the initial state object using the constant:

```typescript
monitoringScope: DEFAULT_MONITORING_SCOPE,
```

### Step 4: Update `useVsCodeMessage` to pass the new field

In `webview-ui/src/hooks/useVsCodeMessage.ts`, find the `state:full` case and add the 8th argument:

```typescript
case 'state:full':
  setFullState(
    message.sessions,
    message.activities,
    message.conversation,
    message.toolStats,
    message.tokenSummaries,
    message.isNestedSession,
    message.focusedSessionId,
    message.monitoringScope   // new — passes actual scope from extension
  );
  break;
```

### Step 5: Verify TypeScript compiles

```bash
npm run lint
```

Expected: no errors. TypeScript will catch any call site that's still broken.

### Step 6: Commit

```bash
git add src/models/protocol.ts webview-ui/src/config/strings.ts webview-ui/src/store/dashboardStore.ts webview-ui/src/hooks/useVsCodeMessage.ts
git commit -m "feat: thread monitoringScope through state:full IPC into Zustand store

setFullState takes an optional 8th param so existing test call sites
(which pass 7 args) are unaffected — they get the DEFAULT_MONITORING_SCOPE."
```

---

## Task 4: Send `monitoringScope` from DashboardPanel

**Files:**
- Modify: `src/DashboardPanel.ts`
- Modify: `src/__tests__/DashboardPanel.test.ts`

### Step 1: Add `getMonitoringScope` to `createMockSessionTracker()`

Open `src/__tests__/DashboardPanel.test.ts`. Find `createMockSessionTracker()` (line 93). Add the missing mock method:

```typescript
function createMockSessionTracker(): any {
  return {
    onStateChanged: vi.fn(() => ({ dispose: vi.fn() })),
    getState: vi.fn(() => ({
      sessions: [],
      activities: [],
      conversation: [],
      toolStats: [],
      tokenSummaries: [],
    })),
    getFilteredActivities: vi.fn(() => []),
    getFilteredConversation: vi.fn(() => []),
    getContinuationMemberIds: vi.fn(() => new Set<string>()),
    getMostRecentContinuationMember: vi.fn((id: string) => id),
    getGroupMembers: vi.fn((id: string) => [id]),
    refresh: vi.fn(),
    getMonitoringScope: vi.fn().mockReturnValue('~/.claude/projects/'),  // ← add this
  };
}
```

> **Why this matters:** Without this, every existing `postFullState` test will throw `TypeError: mockSessionTracker.getMonitoringScope is not a function` after we update DashboardPanel in Step 3.

### Step 2: Write the failing test for the new field

Add a test for the new field in the `postFullState` describe block:

```typescript
it('postFullState includes monitoringScope from sessionTracker', () => {
  const mockScope = '~/.claude/projects/-home-user-myapp/';
  mockSessionTracker.getMonitoringScope.mockReturnValue(mockScope);

  panel.postFullState();

  expect(mockWebview.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'state:full',
      monitoringScope: mockScope,
    })
  );
});
```

### Step 3: Run to verify failure

```bash
npx vitest run src/__tests__/DashboardPanel.test.ts --reporter=verbose 2>&1 | grep -A 5 "monitoringScope"
```

Expected: FAIL — field missing from `postMessage` call.

### Step 4: Update `postFullState()` in DashboardPanel

In `src/DashboardPanel.ts`, find `postFullState()` (around line 294). Add `monitoringScope` to the message:

```typescript
this.postMessage({
  type: 'state:full',
  sessions,
  activities: state.activities,
  conversation: state.conversation,
  toolStats: state.toolStats,
  tokenSummaries: state.tokenSummaries,
  isNestedSession: isInsideClaudeSession(),
  focusedSessionId: this.focusedSessionId,
  monitoringScope: this.sessionTracker.getMonitoringScope(),   // new
});
```

### Step 5: Run tests to verify pass

```bash
npx vitest run src/__tests__/DashboardPanel.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: PASS.

### Step 6: Commit

```bash
git add src/DashboardPanel.ts src/__tests__/DashboardPanel.test.ts
git commit -m "feat: include monitoringScope in state:full IPC message from DashboardPanel"
```

---

## Task 5: Display dynamic monitoring scope in EmptyState

**Files:**
- Modify: `webview-ui/src/components/EmptyState.tsx`

> `UI_STRINGS.EMPTY_STATE_MONITORING` was deleted in Task 3. `EmptyState.tsx` still imports `UI_STRINGS` — keep that import because it uses `EMPTY_STATE_HEADING` and `EMPTY_STATE_DESCRIPTION`.

### Step 1: Update EmptyState to read `monitoringScope` from the store

Replace the import of `UI_STRINGS.EMPTY_STATE_MONITORING` usage with a store selector. The file should look like:

```tsx
import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { UI_STRINGS } from '../config/strings';

export function EmptyState(): React.ReactElement {
  const monitoringScope = useDashboardStore((s) => s.monitoringScope);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '300px', /* inline-ok */
        color: 'var(--fg-secondary)',
        textAlign: 'center',
        padding: 'var(--spacing-xl)',
      }}
    >
      <div
        style={{ fontSize: '48px' /* inline-ok */, marginBottom: 'var(--spacing-lg)', opacity: 0.5 }}
      >
        {'{ }'}
      </div>
      <h2
        style={{
          color: 'var(--fg-primary)',
          fontSize: '18px', /* inline-ok */
          fontWeight: 600,
          marginBottom: 'var(--spacing-sm)',
        }}
      >
        {UI_STRINGS.EMPTY_STATE_HEADING}
      </h2>
      <p style={{ maxWidth: '400px' /* inline-ok */, lineHeight: 1.6 }}>
        {UI_STRINGS.EMPTY_STATE_DESCRIPTION}
      </p>
      <p
        style={{
          marginTop: 'var(--spacing-md)',
          fontSize: '12px', /* inline-ok */
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {monitoringScope}
      </p>
    </div>
  );
}
```

### Step 2: Verify the build compiles

```bash
cd webview-ui && npm run build 2>&1 | tail -10
```

Expected: no errors.

### Step 3: Commit

```bash
git add webview-ui/src/components/EmptyState.tsx
git commit -m "fix: show actual monitored path in empty state instead of hardcoded string

Previously always showed '~/.claude/projects/' even when scoped to a
specific subdirectory or when additionalWorkspaces had no matching dirs."
```

---

## Task 6: Full build + test run

### Step 1: Run all tests

```bash
npm run test 2>&1 | tail -20
```

Expected: all pass.

### Step 2: Run lint

```bash
npm run lint:all 2>&1 | tail -10
```

Expected: no errors.

### Step 3: Build everything

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build.

### Step 4: Manual smoke test

Press F5 in VS Code to launch the Extension Development Host. Open Conductor. Verify:
- Sessions from all projects appear (not just the current workspace)
- The empty state footer shows the actual monitoring path (e.g. `~/.claude/projects/`)
- If you add a fake path to `conductor.additionalWorkspaces` settings, the empty state shows `~/.claude/projects/ (no workspace matches)`
- Sessions from `~/.claude/projects/` that are <1 hour old are visible

---

## What's NOT in this plan

- The `MAX_AGE_MS = 1 hour` scan window in `TranscriptWatcher.ts` is a separate issue. A session active more than 1 hour ago won't appear until you hit Refresh (which uses the 4-hour `REFRESH_WINDOW_MS`). That's a separate PR.
- The `conductor.additionalWorkspaces` setting description in `package.json` should probably be updated to say it's the *only* way to scope — but that's docs-only and not blocking.
