# Auto-Reconnect Terminals on Startup

**Date:** 2026-02-26
**Status:** Design
**Phase:** 1 of 2 (Phase 2: Claude Code hook integration for real-time state)

## Problem

When the Conductor extension reloads (VS Code restart, extension host crash, window reload), all terminal connections to Conductor-launched Claude sessions are lost. The `conductorLaunchedIds` set is in-memory only and starts empty. Users must manually re-adopt each session.

## Goals

1. Persist which sessions were launched/adopted by Conductor across extension restarts.
2. On startup, automatically re-open terminals for sessions whose Claude process is still running.
3. Show a notification summarizing reconnected sessions.

## Design

### New: `LaunchedSessionStore`

**File:** `src/persistence/LaunchedSessionStore.ts`
**Interface:** `ILaunchedSessionStore`

```typescript
export interface ILaunchedSessionStore {
  save(sessionId: string): void;
  remove(sessionId: string): void;
  getAll(): string[];
  prune(maxAgeDays?: number): void;
}
```

- Uses VS Code `ExtensionContext.workspaceState` (consistent with `SessionNameStore`, `SessionOrderStore`)
- Storage format: `Record<string, number>` mapping sessionId → timestamp (epoch ms)
- `prune()` removes entries older than 7 days (configurable via `LAUNCHED_SESSION_TTL_DAYS`)
- `getAll()` auto-prunes before returning

### Process Detection

Instead of trusting the state machine, use OS-level process detection:

```bash
pgrep -f "claude.*--session-id <sessionId>"
```

- Exit code 0 → process alive, worth reconnecting
- Non-zero → process dead, skip auto-reconnect (session still shows as `launchedByConductor` in dashboard)
- Platform: macOS/Linux only (`pgrep`). Windows: `tasklist` fallback (future).

### Auto-Reconnect Flow

Triggered in `extension.ts` after `sessionTracker.start()`:

1. Wait for first `sessionTracker.onUpdate` event (sessions discovered from JSONL)
2. Load `launchedSessionStore.getAll()`
3. For each persisted ID:
   - Run `pgrep` to check if Claude process is alive
   - If alive AND not already tracked by `SessionLauncher.isLaunchedSession()`:
     - Resolve CWD from SessionTracker state
     - Call `sessionLauncher.resume(sessionId, '', cwd)`
     - Register in PtyBridge
4. Cap at `MAX_AUTO_RECONNECT_SESSIONS` (5) to avoid terminal flood
5. Show VS Code notification: "Conductor: Reconnected to N active sessions"

### Modified Files

| File | Change |
|------|--------|
| `src/persistence/LaunchedSessionStore.ts` | **New** — persistence layer |
| `src/persistence/ILaunchedSessionStore.ts` | **New** — interface |
| `src/extension.ts` | Instantiate store, pass to DashboardPanel/SessionLauncher, add auto-reconnect logic |
| `src/DashboardPanel.ts` | Initialize `conductorLaunchedIds` from store on construction, call `store.save()` on launch/adopt |
| `src/terminal/SessionLauncher.ts` | Accept `ILaunchedSessionStore`, call `store.save()` on launch/resume |
| `src/terminal/ISessionLauncher.ts` | Update interface to accept store dependency |
| `src/constants.ts` | Add `AUTO_RECONNECT_DELAY_MS`, `MAX_AUTO_RECONNECT_SESSIONS`, `LAUNCHED_SESSION_TTL_DAYS` |

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `AUTO_RECONNECT_DELAY_MS` | 2000 | Delay after first onUpdate before auto-reconnect |
| `MAX_AUTO_RECONNECT_SESSIONS` | 5 | Cap on terminals opened automatically |
| `LAUNCHED_SESSION_TTL_DAYS` | 7 | Prune persisted IDs older than this |

### UX

- Terminals open silently (no dialog/prompt)
- Single notification after all reconnections: "Conductor: Reconnected to N active sessions"
- Dead sessions still appear with `launchedByConductor: true` in dashboard (user can manually resume)
- If 0 sessions need reconnecting, no notification shown

### Tests

**File:** `src/__tests__/LaunchedSessionStore.test.ts`

- save/remove/getAll basic operations
- Prune removes entries older than TTL
- getAll auto-prunes
- Duplicate save updates timestamp
- Integration: auto-reconnect flow (mock pgrep + SessionLauncher)

## Phase 2 (Future)

Integrate Claude Code hooks (`SessionStart`, `Stop`, `SessionEnd`) for real-time state accuracy:
- Install hooks via `.claude/settings.local.json`
- Hooks write lifecycle events to a state file
- Extension watches state file for authoritative transitions
- Supplements JSONL-based state machine with ground-truth lifecycle events

## References

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Peon-ping](https://github.com/PeonPing/peon-ping) — uses CESP event mapping from Claude hooks for state detection
