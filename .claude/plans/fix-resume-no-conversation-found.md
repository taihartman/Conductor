# Plan: Fix "No conversation found" on Session Adoption

## Root Cause Analysis

When the user adopts an active external session, Conductor runs `claude --resume <sessionId>` via node-pty. Claude CLI responds with "No conversation found with session ID: <uuid>" even though the JSONL file exists.

**Investigation findings:**

1. **The session ID is correct** — For non-continuation sessions, `getMostRecentContinuationMember()` returns the original ID. The JSONL file exists at the expected path.

2. **`cwd` is reliably populated** — 88-97% of JSONL records contain `cwd`. The lookup at `DashboardPanel:571` correctly finds the session.

3. **Most likely cause: the session is still active** — `claude --resume` cannot resume a conversation that's currently owned by a running Claude Code process. The original session was in AWAITING INPUT (actively running), so the CLI correctly refuses to open it — but uses a confusing error message ("No conversation found" instead of "conversation in use").

4. **Latent env bug** — `spawnWithNodePty` at line 355 does `env: { ...process.env, FORCE_COLOR: '1' }`, inheriting all `CLAUDE_ENV` vars (`CLAUDECODE`, `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_ENTRYPOINT`) if the Extension Host was started from within a Claude Code session. This causes the spawned `claude` process to either refuse to run (nesting detection) or attempt IPC with the parent session's SSE server.

## Changes

### 1. Strip all `CLAUDE_ENV` variables from spawned process env (`SessionLauncher.ts`)

**File:** `src/terminal/SessionLauncher.ts`

Build a clean env that removes all three Claude env vars so spawned sessions don't think they're nested and don't try to IPC with a parent session.

**node-pty path** (line 355): Replace `{ ...process.env, FORCE_COLOR: '1' }` with a cleaned env:

```typescript
const cleanEnv = { ...process.env };
delete cleanEnv[CLAUDE_ENV.ACTIVE];
delete cleanEnv[CLAUDE_ENV.SSE_PORT];
delete cleanEnv[CLAUDE_ENV.ENTRYPOINT];
const spawnEnv = { ...cleanEnv, FORCE_COLOR: '1' } as Record<string, string>;
```

**shellPath path** (line 459): VS Code's terminal `env` option is *overrides* on the inherited env, not a complete replacement. `CLAUDECODE` still leaks through the shell's inherited env. Fix by explicitly nullifying the Claude env vars:

```typescript
env: {
  FORCE_COLOR: '1',
  [CLAUDE_ENV.ACTIVE]: '',
  [CLAUDE_ENV.SSE_PORT]: '',
  [CLAUDE_ENV.ENTRYPOINT]: '',
},
```

Extract the env-building into a shared private method `buildCleanSpawnEnv()` to avoid duplication.

### 2. Detect adoption errors via `onSessionExit` (`DashboardPanel.ts`)

**File:** `src/DashboardPanel.ts`

Use the existing `onSessionExit` event (not PTY text scanning — PTY data arrives in arbitrary chunks and can be split by ANSI escapes). Detection logic:

- Track adoption spawn timestamps in a `Map<sessionId, number>`
- Listen to `sessionLauncher.onSessionExit`
- If a session exits with non-zero code within `TIMING.ADOPT_ERROR_WINDOW_MS` of its spawn time, treat it as an adoption error
- Post `session:adopt-status` with `status: 'error'` and the user-facing error string
- Clean up the timestamp entry

This is reliable because:
- Exit codes are an unambiguous signal (no parsing needed)
- The timing window distinguishes "failed to start" from "user closed after working"
- No dependency on Claude CLI error message wording

### 3. Add timing constant (`constants.ts`)

**File:** `src/constants.ts`

```typescript
// In TIMING object:
/** Window after adoption spawn during which a non-zero exit is treated as an adoption error. */
ADOPT_ERROR_WINDOW_MS: 5_000,
```

### 4. Add user-facing error strings (`strings.ts`)

**File:** `webview-ui/src/config/strings.ts`

```typescript
ADOPT_ERROR_RESUME_FAILED: 'Could not resume this session. It may still be active in another terminal. Close the original terminal first, then try again.',
```

### 5. Update webview to show adoption errors inline

**File:** `webview-ui/src/hooks/useVsCodeMessage.ts`, `webview-ui/src/components/TerminalView.tsx`

The existing `session:adopt-status` handler at line 51 already handles errors by calling `removePendingAdoption`. But when the status is `'error'`, the webview currently does nothing visible.

- On `adopt-status: error`, store the error message in the Zustand store (keyed by sessionId)
- In `TerminalView` or `DetailPanel`, if an adoption error exists for the current session, show the error string instead of the terminal
- Clear the error when the user retries adoption

## Files Changed

| File | Change |
|------|--------|
| `src/terminal/SessionLauncher.ts` | Strip all `CLAUDE_ENV` vars from both spawn paths via shared `buildCleanSpawnEnv()` |
| `src/DashboardPanel.ts` | Track adoption timestamps, detect early exit as error, post `adopt-status: error` |
| `src/constants.ts` | Add `ADOPT_ERROR_WINDOW_MS` to `TIMING` |
| `webview-ui/src/config/strings.ts` | Add `ADOPT_ERROR_RESUME_FAILED` |
| `webview-ui/src/hooks/useVsCodeMessage.ts` | Store adoption error in Zustand on `adopt-status: error` |
| `webview-ui/src/store/dashboardStore.ts` | Add `adoptionErrors: Map<string, string>` slice |
| `webview-ui/src/components/TerminalView.tsx` | Show error overlay when adoption failed |

## Testing

- **SessionLauncher.test.ts**: Verify spawned env does NOT contain `CLAUDECODE`, `CLAUDE_CODE_SSE_PORT`, or `CLAUDE_CODE_ENTRYPOINT` (both node-pty and shellPath paths)
- **DashboardPanel.test.ts**: Mock `onSessionExit` firing with non-zero code within the error window → verify `session:adopt-status` with `status: 'error'` is posted
- **DashboardPanel.test.ts**: Mock `onSessionExit` firing with non-zero code OUTSIDE the error window → verify no adopt-status error is posted
- **Manual test**: Adopt an active session → see user-friendly error instead of raw CLI output in terminal view

## What This Doesn't Fix

- **Fundamentally can't adopt a running session via `--resume`** — Claude CLI locks conversations to the running process. The user must close the original terminal before adopting.
- This plan focuses on **clear error feedback** so the user understands what to do, plus **fixing the env leak** that would cause adoption to always fail when VS Code is launched from within Claude Code.
