# Design: Split Button with Launch Modes

## Overview

Replace the single "New Session" button in the Conductor header with a **split button** that supports three launch modes: Normal, YOLO (bypass permissions), and Remote Control (phone access). The primary click area launches with the last-used mode; a chevron dropdown switches modes.

**Delivery strategy**: Two PRs to manage risk.

- **PR1 (this plan)**: Normal + YOLO modes. Straightforward extension of existing launch pipeline.
- **PR2 (future)**: Remote Control mode. Requires dedicated launch flow, PTY output parsing for session ID correlation, and remote URL discovery. Designed here but implemented separately.

## Launch Modes

| Mode | Label | CLI Command | Session ID | PR |
|---|---|---|---|---|
| `normal` | New Session | `claude --session-id <uuid>` | Pre-assigned UUID | 1 |
| `yolo` | Bypass Permissions | `claude --session-id <uuid> --dangerously-skip-permissions` | Pre-assigned UUID | 1 |
| `remote` | Remote Control | `claude remote-control` | Discovered from PTY output | 2 |

---

## PR1: Normal + YOLO Modes

### Shared Constants (`src/models/sharedConstants.ts`)

Add to `sharedConstants.ts` (importable by both extension and webview via `@shared` alias):

```typescript
/** Launch mode discriminators for the split button. */
export const LAUNCH_MODES = {
  NORMAL: 'normal',
  YOLO: 'yolo',
  REMOTE: 'remote',
} as const;

export type LaunchMode = (typeof LAUNCH_MODES)[keyof typeof LAUNCH_MODES];
```

Re-export from `src/constants.ts` alongside existing shared constants.

### Extension Constants (`src/constants.ts`)

```typescript
/** CLI argument strings for session launch modes. */
export const CLAUDE_CLI = {
  DANGEROUSLY_SKIP_PERMISSIONS: '--dangerously-skip-permissions',
  REMOTE_CONTROL: 'remote-control',
} as const;

/** VS Code workspaceState keys — add to existing WORKSPACE_STATE_KEYS. */
LAUNCH_MODE: 'conductor.launchMode',
/** Map of sessionId → LaunchMode for Conductor-launched sessions. */
LAUNCHED_SESSION_MODES: 'conductor.launchedSessionModes',
```

### Types (`src/models/types.ts`)

Add `launchMode?: LaunchMode` field to `SessionInfo`:

```typescript
/** Launch mode used when this session was started by Conductor. */
launchMode?: LaunchMode;
```

No new `LaunchResult` type needed — `launch()` continues to return `Promise<string>` (session UUID). The mode is tracked separately.

### ISessionLauncher (`src/terminal/ISessionLauncher.ts`)

Update `launch()` signature — add optional `mode` parameter, keep return type as `Promise<string>`:

```typescript
launch(cwd?: string, mode?: LaunchMode): Promise<string>;
```

No other interface changes for PR1.

### SessionLauncher (`src/terminal/SessionLauncher.ts`)

- `launch()` receives optional `mode` parameter (defaults to `LAUNCH_MODES.NORMAL`).
- Builds args based on mode:
  - `normal`: `['--session-id', uuid]` (unchanged)
  - `yolo`: `['--session-id', uuid, '--dangerously-skip-permissions']`
- `remote` mode throws `Error('Remote mode not yet supported')` in PR1 as a guard.
- Add `mode` field to the `LaunchedSession` internal interface for bookkeeping.
- Return type stays `Promise<string>` — the session UUID.

### IPC Protocol (`src/models/protocol.ts`)

Update the existing `session:launch` message — add `mode`, preserve `cwd`:

```typescript
/** Request to launch a new Claude Code session from within Conductor. */
| { type: 'session:launch'; cwd?: string; mode?: LaunchMode }
```

No new Extension → Webview messages in PR1.

### All Callers of `launch()` — Exhaustive List

1. **`DashboardPanel.ts` → `handleLaunch()`** (line 435): receives `cwd` and new `mode` from IPC message, passes both to `sessionLauncher.launch(cwd, mode)`.

2. **`extension.ts` → `COMMANDS.LAUNCH_SESSION` handler** (line 69): command palette entry point. No mode selection UI here — always launches with `LAUNCH_MODES.NORMAL`. Signature: `sessionLauncher.launch(undefined, LAUNCH_MODES.NORMAL)`.

3. **`SessionLauncher.test.ts`**: update existing tests, add new mode-specific tests.

### DashboardPanel (`src/DashboardPanel.ts`)

**`handleLaunch` changes:**

```typescript
private handleLaunch(cwd?: string, mode?: LaunchMode): void {
  const launchMode = mode ?? LAUNCH_MODES.NORMAL;
  this.sessionLauncher
    .launch(cwd, launchMode)
    .then((sessionId) => {
      this.launchedSessionModes.set(sessionId, launchMode);
      this.persistLaunchedModes();
      this.notifySessionLaunched(sessionId);
    })
    .catch(...);
}
```

**`handleMessage` case update:**

```typescript
case 'session:launch':
  this.handleLaunch(message.cwd, message.mode);
  break;
```

**Mode injection into `SessionInfo`** — in `applyCustomNames()` (the existing method that injects `customName` and `launchedByConductor`), also inject `launchMode`:

```typescript
// Existing launchedByConductor logic, plus:
const launchMode = this.launchedSessionModes.get(session.sessionId);
return {
  ...session,
  ...(customName ? { customName } : {}),
  ...(launchedByConductor ? { launchedByConductor: true } : {}),
  ...(launchMode ? { launchMode } : {}),
};
```

**Mode persistence** — new private field + methods:

```typescript
/** sessionId → LaunchMode for Conductor-launched sessions. Persisted to workspaceState. */
private launchedSessionModes = new Map<string, LaunchMode>();
```

- On construction: restore from `workspaceState.get(WORKSPACE_STATE_KEYS.LAUNCHED_SESSION_MODES)`.
- `persistLaunchedModes()`: serialize Map to `Record<string, string>`, write to workspace state.
- On PTY buffer prune (existing `pruneOrphanedPtyBuffers`): also prune stale entries from `launchedSessionModes`.

**Last-used mode persistence** — new IPC round-trip:

- On `ready`: send `{ type: 'launch-mode:current'; mode: LaunchMode }` with value from `workspaceState.get(WORKSPACE_STATE_KEYS.LAUNCH_MODE, 'normal')`.
- On new `session:set-launch-mode` message from webview: persist to `workspaceState`.

Add to protocol.ts:

```typescript
// Extension → Webview
| { type: 'launch-mode:current'; mode: LaunchMode }

// Webview → Extension
| { type: 'session:set-launch-mode'; mode: LaunchMode }
```

### Webview Changes

#### New Component: `SplitButton.tsx`

Split button with two click zones:
- **Left (primary)**: launches with current mode. Shows mode-specific label.
- **Right (chevron `▾`)**: toggles a dropdown overlay.

Dropdown items (PR1 shows 2, with Remote greyed out):
1. **Normal** — "New Session"
2. **YOLO** — amber warning icon, "Bypass Permissions"
3. **Remote** — greyed out, "Remote Control (coming soon)"

Clicking a dropdown item:
1. Sets it as the active mode (posts `session:set-launch-mode` to extension for persistence).
2. Immediately launches a session in that mode.

**Accessibility:**
- Chevron button: `aria-haspopup="true"`, `aria-expanded={isOpen}`.
- Dropdown: `role="menu"`, items have `role="menuitem"`.
- Keyboard: Arrow keys navigate dropdown items, Enter selects, Escape closes.
- Click-outside handler via `useRef` + `useEffect` event listener (matching existing SearchInput pattern).

**Props interface:**

```typescript
interface SplitButtonProps {
  currentMode: LaunchMode;
  onLaunch: (mode: LaunchMode) => void;
  onModeChange: (mode: LaunchMode) => void;
  disabled?: boolean;
}
```

#### ConductorHeader.tsx

Replace current button with SplitButton:

```tsx
<SplitButton
  currentMode={launchMode}
  onLaunch={onLaunchSession}
  onModeChange={onLaunchModeChange}
  disabled={isNestedSession}
/>
```

Update `ConductorHeaderProps`:
- `onLaunchSession: (mode: LaunchMode) => void` (was `() => void`)
- Add `onLaunchModeChange: (mode: LaunchMode) => void`
- Add `launchMode: LaunchMode`

#### Session Card Indicators

**YOLO sessions**: Small amber "YOLO" micro-badge next to the session name, using `var(--status-waiting)` for the amber color. Rendered conditionally when `session.launchMode === LAUNCH_MODES.YOLO`.

#### Zustand Store (`dashboardStore.ts`)

Add:
```typescript
launchMode: LaunchMode;  // last-used mode, default LAUNCH_MODES.NORMAL
setLaunchMode: (mode: LaunchMode) => void;
```

No `remoteUrls` map in PR1.

#### useVsCodeMessage hook

Handle new `launch-mode:current` message to initialize store on ready:

```typescript
case 'launch-mode:current':
  store.setLaunchMode(message.mode);
  break;
```

#### Strings (`webview-ui/src/config/strings.ts`)

```typescript
LAUNCH_MODE_NORMAL: 'New Session',
LAUNCH_MODE_YOLO: 'Bypass Permissions',
LAUNCH_MODE_REMOTE: 'Remote Control',
LAUNCH_MODE_REMOTE_COMING_SOON: 'Remote Control (coming soon)',
YOLO_BADGE: 'YOLO',
YOLO_DROPDOWN_WARNING: 'Skips all permission prompts',
SPLIT_BUTTON_CHEVRON_LABEL: 'Select launch mode',
SPLIT_BUTTON_DROPDOWN_LABEL: 'Launch mode options',
```

### Testing

| Test File | What to Test |
|---|---|
| `SessionLauncher.test.ts` | `launch()` with no mode → normal args; `launch(cwd, 'yolo')` → includes `--dangerously-skip-permissions`; `launch(cwd, 'remote')` → throws "not yet supported"; mode stored in LaunchedSession |
| `SplitButton.test.tsx` | Dropdown opens on chevron click, closes on outside click; mode selection fires `onLaunch` + `onModeChange`; displays current mode label; disabled state disables both zones; keyboard navigation (arrow keys, Enter, Escape); ARIA attributes present |
| `DashboardPanel.test.ts` | `session:launch` with mode forwarded to launcher; mode persisted to workspace state; mode injected into SessionInfo via applyCustomNames; `session:set-launch-mode` persists preference; `launch-mode:current` sent on ready |
| `extension.ts` (existing) | `COMMANDS.LAUNCH_SESSION` calls `launch(undefined, 'normal')` |

### Edge Cases

- **YOLO badge persistence**: `launchedSessionModes` Map persisted to workspace state survives restarts. Pruned alongside PTY buffers when sessions expire.
- **Mode persistence**: stored per-workspace via `WORKSPACE_STATE_KEYS.LAUNCH_MODE`. Restored on webview `ready` via `launch-mode:current` IPC message.
- **Nested session**: all modes disabled (existing `isInsideClaudeSession()` guard). Split button shows disabled state with existing tooltip.
- **Command palette launch**: always uses `normal` mode (no mode selection UI outside webview).

---

## PR2: Remote Control Mode (Future — Design Only)

### The Correlation Problem

`claude remote-control` does not accept `--session-id`. The session ID only appears in the JSONL file and in the PTY startup output. To link the PTY process to the dashboard session:

1. **PTY output parser**: Scan `onData` output for the session ID pattern. Claude Code prints the session identifier during startup. Capture it with a regex stored in `REMOTE_DETECTION.SESSION_ID_PATTERN` constant.
2. **Retroactive registration**: Once the session ID is discovered from PTY output, call `ptyBridge.registerSession(discoveredId)` and update `launchedSessionModes` — linking the existing PTY process to the SessionTracker entry.
3. **Temporary placeholder**: Before the session ID is discovered, use a placeholder ID (`remote-pending-<uuid>`) internally. This placeholder is never sent to Zustand as `pendingLaunchSessionId` (avoids the falsy-string bug).

### Dedicated Launch Flow

Add a separate method to `ISessionLauncher`:

```typescript
/** Launch a remote control session. Returns a pending handle — no session ID available yet. */
launchRemote(cwd?: string): Promise<RemoteLaunchHandle>;

interface RemoteLaunchHandle {
  placeholderId: string;  // internal tracking only
  /** Fires when the real session ID is discovered from PTY output. */
  onSessionDiscovered: vscode.Event<string>;
  /** Fires when the remote URL is discovered from PTY output. */
  onRemoteUrl: vscode.Event<string>;
}
```

This avoids contaminating the existing `launch()` return contract.

### Remote URL Discovery

- Regex pattern for URL: stored in `REMOTE_DETECTION.URL_PATTERN` constant.
- Timeout: if no URL found within `REMOTE_DETECTION.URL_TIMEOUT_MS` (60s), fire error to webview.
- New IPC message: `{ type: 'remote:url'; sessionId: string; url: string }`.
- On webview `ready`: replay known remote URLs (stored in `Record<string, string>`, not `Map`).

### Remote Mode in Webview

- `remoteUrls: Record<string, string>` in Zustand store (serializable, replayed on ready).
- Remote sessions show phone icon + clickable URL/copy button on session card.
- Remote mode greyed out in dropdown when node-pty is unavailable (shellPath fallback has no output capture).

### Strings for PR2

```typescript
REMOTE_URL_COPIED: 'Remote URL copied',
REMOTE_URL_TIMEOUT: 'Could not detect remote session URL',
REMOTE_REQUIRES_PTY: 'Remote mode requires full terminal support',
```
