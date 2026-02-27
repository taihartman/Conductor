# Hybrid Hooks + JSONL State Detection

**Date**: 2026-02-27
**Status**: Design (v2 — addresses staff engineer review)
**Review**: See [Review Fixes](#appendix-review-fixes-v2) for all changes from v1.

## Problem

The JSONL-based state machine is inaccurate. It guesses session state by inferring meaning from transcript records, producing false "Awaiting Input" states (every auto-approved tool call), false "Completed" flashes (intermission timer kills active sessions), and stale states (replay detection runs after state mutations).

## Solution

Use Claude Code hooks as the **authoritative state source** for session status. Keep JSONL parsing for analytics only (tokens, tool stats, conversation turns). The state machine becomes a fallback for sessions that don't have hook events (e.g., older Claude Code versions without hooks support).

## Architecture

```
Claude Code session
    │
    ├── writes ~/.claude/projects/**/*.jsonl  (transcript data)
    │       ↓
    │   TranscriptWatcher → JsonlParser → SessionTracker
    │       → tokens, tool stats, conversation turns, activity events
    │       → state machine runs but status sync SKIPPED when hooks are active
    │
    └── fires hook events (stdin JSON to conductor-hook.sh)
            ↓
        conductor-hook.sh appends to ~/.conductor/events/<session-id>.jsonl
            ↓
        HookEventWatcher (1s poll, own parser — not JsonlParser)
            ↓
        SessionTracker.applyHookEvent()
            → overrideStatus() — cancels timers + sets status atomically
            → session.info.lastActivityAt — resets inactivity timer
            → drains pending hook buffer for newly-discovered sessions
            → emitStateChanged() — debounced 100ms → dashboard
```

---

## Part 1: Bug Fixes (Immediate)

Fix the 4 critical bugs in the existing state machine. These improve accuracy for all users regardless of hook adoption, and the state machine remains the fallback.

### Fix 1: Stop treating every tool call as WAITING

**File**: `src/monitoring/SessionStateMachine.ts`, lines 212–232

**Current**: Every `tool_use` record sets `WAITING` with tool approval UI, assuming `tool_result` arrives in the same polling batch (wrong for tools taking >1s).

**Fix**: Use `stop_reason` to discriminate:
- `stop_reason === 'tool_use'` → `WAITING` (Claude stopped to ask permission)
- `stop_reason === null` (streaming) → `WORKING` (auto-approved tool running)
- `stop_reason === 'end_turn'` with tool blocks → `WORKING` (unexpected edge, safe default)

Only set `isToolApproval` pending question when actually entering `WAITING`.

**Caveat**: `stop_reason === 'tool_use'` doesn't always mean "needs approval" — auto-approved tools can also have this stop reason in some patterns. This fix is an improvement, not a complete solution. With hooks active, `PermissionRequest` gives the definitive answer, making this a non-issue.

### Fix 2: Remove intermission timer from progress records

**File**: `src/monitoring/SessionStateMachine.ts`, lines 324–331

Progress records signal work in progress. They should NOT start a countdown to `DONE`. Remove `startIntermissionTimer()` from `handleProgressRecord()`.

### Fix 3: Only start intermission timer when transitioning to THINKING

**File**: `src/monitoring/SessionStateMachine.ts`, lines 237–244

Move `startIntermissionTimer()` inside the `if` block that transitions to `THINKING`. When status stays `WORKING` or `ERROR`, no timer should start.

### Fix 4: Guard intermission timer against WORKING and ERROR states

**File**: `src/monitoring/SessionStateMachine.ts`, lines 338–345

Extend the timer callback guard to also protect `WORKING` and `ERROR`:

```typescript
if (
  this._status !== SESSION_STATUSES.WAITING &&
  this._status !== SESSION_STATUSES.WORKING &&
  this._status !== SESSION_STATUSES.ERROR
) {
  this._status = SESSION_STATUSES.DONE;
  this.onStateChanged();
}
```

### Fix 5: Make `setStatus()` cancel timers (new — from review)

**File**: `src/monitoring/SessionStateMachine.ts`, line 131

`setStatus()` currently only assigns `_status` without cancelling pending timers. Any external caller that forces a status should also kill the intermission timer — otherwise the timer fires later and overwrites the forced status.

```typescript
setStatus(status: SessionStatus): void {
  this.cancelTimers();
  this._status = status;
}
```

This also means `cancelTimers()` stays private. No interface changes needed — external code calls `setStatus()` which handles cleanup internally. Add `overrideStatus()` as a public alias on the interface if we want to signal intent more clearly:

```typescript
// In ISessionStateMachine:
overrideStatus(status: SessionStatus): void;

// In SessionStateMachine:
overrideStatus(status: SessionStatus): void {
  this.cancelTimers();
  this._status = status;
}
```

---

## Part 2: Hook Script

### Location & Format

```
~/.conductor/
├── hook.sh                          # The hook script (created by extension)
└── events/
    └── <session-id>.jsonl           # One file per session, appended by hook.sh
```

### Hook Script Design

A single bash script (~50 lines). Uses `jq` when available (fast, robust JSON parsing) with a `grep` fallback for systems without `jq`. No Python dependency.

The script:
1. Reads stdin JSON via `cat` into a variable
2. Extracts `hook_event_name` and `session_id` using `jq` (or grep fallback)
3. Sanitizes session_id to prevent path traversal
4. Appends one JSON line to `~/.conductor/events/<session-id>.jsonl`
5. Exits 0 (never blocks Claude)

#### Event → Status Mapping

| Hook Event | Conductor Status | Kanban Column |
|---|---|---|
| `SessionStart` | `working` | Performing |
| `UserPromptSubmit` | `working` | Performing |
| `PreToolUse` | `working` | Performing |
| `PostToolUse` | `working` | Performing |
| `SubagentStart` | `working` | Performing |
| `PermissionRequest` | `waiting` | Awaiting Input |
| `Notification` (idle_prompt) | `waiting` | Awaiting Input |
| `Notification` (permission_prompt) | `waiting` | Awaiting Input |
| `Stop` | `done` | Completed |
| `SessionEnd` | `idle` | Completed |
| `PostToolUseFailure` | (tracked, error threshold checked by SessionTracker) | Needs Attention |
| `PreCompact` | `working` | Performing |

#### Event File Line Format

```jsonl
{"e":"Stop","ts":1709078400,"sid":"abc123"}
{"e":"PermissionRequest","ts":1709078401,"sid":"abc123","tool":"Bash"}
{"e":"PostToolUseFailure","ts":1709078402,"sid":"abc123","tool":"Bash","err":"exit 1"}
```

Deliberately minimal — short keys to keep lines small. Full event data isn't needed; the JSONL transcript has that. We only need the event type and timestamp for state determination.

#### Concurrency Safety

POSIX guarantees atomic append for writes smaller than `PIPE_BUF` (4096 bytes on macOS/Linux). Our event lines are ~100–200 bytes. Simple `>>` append is safe even when multiple hooks fire concurrently for the same session.

#### Hook Script (conductor-hook.sh)

```bash
#!/usr/bin/env bash
# Conductor hook — appends Claude Code state events to per-session event files.
# Installed by the Conductor VS Code extension. Do not edit manually.
# v2 — uses jq with grep fallback, sanitizes session_id

EVENTS_DIR="$HOME/.conductor/events"
mkdir -p "$EVENTS_DIR"

# Read stdin (Claude Code hook JSON)
INPUT="$(cat)"

# Extract fields — prefer jq, fall back to grep
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
  EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
else
  SESSION_ID=$(printf '%s' "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  EVENT=$(printf '%s' "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

# Skip if missing required fields
[ -z "$SESSION_ID" ] && exit 0
[ -z "$EVENT" ] && exit 0

# Sanitize session_id: strip anything that's not alphanumeric, dash, or underscore
SESSION_ID=$(printf '%s' "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
[ -z "$SESSION_ID" ] && exit 0

# Optional fields (only extracted for events that need them)
TOOL=""
ERR=""
NTYPE=""

if command -v jq >/dev/null 2>&1; then
  case "$EVENT" in
    PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest)
      TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty') ;;
    Notification)
      NTYPE=$(printf '%s' "$INPUT" | jq -r '.notification_type // empty') ;;
  esac
  [ "$EVENT" = "PostToolUseFailure" ] && ERR=$(printf '%s' "$INPUT" | jq -r '.error // empty')
else
  case "$EVENT" in
    PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest)
      TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true) ;;
    Notification)
      NTYPE=$(printf '%s' "$INPUT" | grep -o '"notification_type":"[^"]*"' | head -1 | cut -d'"' -f4 || true) ;;
  esac
  [ "$EVENT" = "PostToolUseFailure" ] && \
    ERR=$(printf '%s' "$INPUT" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

# Build minimal JSON line and append
TS=$(date +%s)
LINE="{\"e\":\"$EVENT\",\"ts\":$TS,\"sid\":\"$SESSION_ID\""
[ -n "$TOOL" ] && LINE="$LINE,\"tool\":\"$TOOL\""
[ -n "$ERR" ] && LINE="$LINE,\"err\":\"$ERR\""
[ -n "$NTYPE" ] && LINE="$LINE,\"ntype\":\"$NTYPE\""
LINE="$LINE}"

printf '%s\n' "$LINE" >> "$EVENTS_DIR/$SESSION_ID.jsonl"

exit 0
```

**Key changes from v1**: Removed `set -euo pipefail` (grep returning no match would kill the script before safety guards). Added `jq` with `grep` fallback. Added `|| true` on all grep calls. Added session_id sanitization via `tr -cd`. Used `printf '%s'` instead of `echo` for safety.

### Hook Registration

On extension activation, the extension reads `~/.claude/settings.json`, merges Conductor hooks for all relevant events (alongside existing hooks like peon-ping), and writes the hook script to `~/.conductor/hook.sh`.

Events to register (all `async: true` so they never block Claude):

```json
{
  "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "PermissionRequest": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "PostToolUseFailure": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "SubagentStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }],
  "PreCompact": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.conductor/hook.sh", "timeout": 5, "async": true }] }]
}
```

**Merge strategy**: For each event key, check if a Conductor hook already exists in the hooks array. If not, append it. Never remove or modify non-Conductor hooks. Identification: match on `command` containing `conductor/hook.sh`.

**Atomic write**: Write merged JSON to `~/.claude/settings.json.tmp`, then `fs.renameSync()` to `~/.claude/settings.json`. Rename is atomic on POSIX. If rename fails, fall back to direct write with a retry on parse failure.

---

## Part 3: HookEventWatcher

A new lightweight file watcher purpose-built for hook event files. Does NOT extend or reuse `TranscriptWatcher` (coupled to JSONL transcript semantics) or `JsonlParser` (requires a `type` field, returns `JsonlRecord[]`).

### Why not reuse JsonlParser?

`JsonlParser.parseIncremental()` validates each line with `parsed.type` (line 99) and returns `JsonlRecord[]`. Hook event lines use `e`/`ts`/`sid` keys, not `type`. Every hook event line would be silently dropped. The byte-offset incremental reading technique is reused, but in a new parser that validates for hook event shape.

### Interface

```typescript
// src/models/types.ts (add to existing file — shared domain type)

export interface HookEvent {
  /** Raw hook event name from Claude Code */
  readonly e: string;
  /** Unix timestamp (seconds) */
  readonly ts: number;
  /** Session ID */
  readonly sid: string;
  /** Tool name (for tool-related events) */
  readonly tool?: string;
  /** Error message (for PostToolUseFailure) */
  readonly err?: string;
  /** Notification type (for Notification events) */
  readonly ntype?: string;
}
```

```typescript
// src/monitoring/IHookEventWatcher.ts

import * as vscode from 'vscode';
import { HookEvent } from '../models/types';

export interface IHookEventWatcher extends vscode.Disposable {
  /** Start watching for hook events. */
  start(): void;
  /** Fired when new hook events are read from a session's event file. */
  readonly onHookEvents: vscode.Event<{ sessionId: string; events: HookEvent[] }>;
}
```

### Implementation

```
src/monitoring/HookEventWatcher.ts

- Constructor: takes eventsDir path (default: ~/.conductor/events/)
- start(): setInterval at 1s, scans eventsDir for *.jsonl files
- Per file: tracks byte offset + line buffer (same technique as JsonlParser)
- Parsing: JSON.parse each line, validate for 'e' + 'ts' + 'sid' fields
- New files: detected on each poll (readdir), starts tracking
- Stale files: deleted after 4 hours of no changes (matches SessionTracker cleanup)
- Fires onHookEvents with { sessionId (from filename), events[] }
- dispose(): clears poll timer, releases all file tracking state
```

No FileSystemWatcher needed — 1s polling is sufficient and simpler. The poll reads the directory listing, checks each file's mtime against last-seen mtime, and reads new bytes from changed files.

---

## Part 4: SessionTracker Integration

### Hook Event Constants

```typescript
// In src/constants.ts — add new constant object

/** Hook event names from Claude Code hooks API. */
export const HOOK_EVENTS = {
  SESSION_START: 'SessionStart',
  USER_PROMPT_SUBMIT: 'UserPromptSubmit',
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  POST_TOOL_USE_FAILURE: 'PostToolUseFailure',
  PERMISSION_REQUEST: 'PermissionRequest',
  NOTIFICATION: 'Notification',
  SUBAGENT_START: 'SubagentStart',
  STOP: 'Stop',
  SESSION_END: 'SessionEnd',
  PRE_COMPACT: 'PreCompact',
} as const;

/** Notification subtypes from the Notification hook event. */
export const HOOK_NOTIFICATION_TYPES = {
  IDLE_PROMPT: 'idle_prompt',
  PERMISSION_PROMPT: 'permission_prompt',
} as const;

/** Directory for hook event files written by conductor-hook.sh. */
export const HOOK_EVENTS_DIR = '~/.conductor/events';

/** Staleness threshold: if no hook event for this long, fall back to JSONL. */
export const HOOK_STALENESS_MS = 60_000;

/** Max buffered hook events per session for sessions not yet discovered via JSONL. */
export const HOOK_BUFFER_MAX_EVENTS = 50;

/** TTL for pending hook event buffers (discard if session never appears). */
export const HOOK_BUFFER_TTL_MS = 60_000;
```

### New Method: `applyHookEvent()`

```typescript
// In SessionTracker

/** Sessions that have received at least one hook event. */
private hookActiveForSession = new Set<string>();

/** Timestamp of last hook event per session (for staleness detection). */
private lastHookEventTime = new Map<string, number>();

/** Buffer for hook events that arrive before JSONL discovers the session. */
private pendingHookEvents = new Map<string, { events: HookEvent[]; firstSeen: number }>();

applyHookEvent(sessionId: string, event: HookEvent): void {
  const session = this.sessions.get(sessionId);

  if (!session) {
    // Session not yet discovered via JSONL — buffer the event
    let buffer = this.pendingHookEvents.get(sessionId);
    if (!buffer) {
      buffer = { events: [], firstSeen: Date.now() };
      this.pendingHookEvents.set(sessionId, buffer);
    }
    if (buffer.events.length < HOOK_BUFFER_MAX_EVENTS) {
      buffer.events.push(event);
    }
    return;
  }

  this.hookActiveForSession.add(sessionId);
  this.lastHookEventTime.set(sessionId, Date.now());

  const status = this.mapHookEventToStatus(event);
  if (status) {
    session.stateMachine.overrideStatus(status);
    session.info.status = status;
  }

  // Update lastActivityAt to prevent inactivity timeout from overriding
  session.info.lastActivityAt = new Date(event.ts * 1000).toISOString();

  // Track tool errors for error state threshold
  if (event.e === HOOK_EVENTS.POST_TOOL_USE_FAILURE) {
    session.stateMachine.recordHookError(event.tool || 'unknown');
    if (session.stateMachine.recentErrorCount >= ERROR_THRESHOLD) {
      session.stateMachine.overrideStatus(SESSION_STATUSES.ERROR);
      session.info.status = SESSION_STATUSES.ERROR;
    }
  }

  this.emitStateChanged();
}

private mapHookEventToStatus(event: HookEvent): SessionStatus | null {
  switch (event.e) {
    case HOOK_EVENTS.SESSION_START:
    case HOOK_EVENTS.USER_PROMPT_SUBMIT:
    case HOOK_EVENTS.PRE_TOOL_USE:
    case HOOK_EVENTS.POST_TOOL_USE:
    case HOOK_EVENTS.SUBAGENT_START:
    case HOOK_EVENTS.PRE_COMPACT:
      return SESSION_STATUSES.WORKING;

    case HOOK_EVENTS.PERMISSION_REQUEST:
      return SESSION_STATUSES.WAITING;

    case HOOK_EVENTS.NOTIFICATION:
      if (
        event.ntype === HOOK_NOTIFICATION_TYPES.IDLE_PROMPT ||
        event.ntype === HOOK_NOTIFICATION_TYPES.PERMISSION_PROMPT
      ) {
        return SESSION_STATUSES.WAITING;
      }
      return null;

    case HOOK_EVENTS.STOP:
      return SESSION_STATUSES.DONE;

    case HOOK_EVENTS.SESSION_END:
      return SESSION_STATUSES.IDLE;

    case HOOK_EVENTS.POST_TOOL_USE_FAILURE:
      return null;  // Error tracking handled via threshold above

    default:
      return null;
  }
}
```

### JSONL Status Sync — The Critical Guard

**This is the most important change in the entire plan.** Without this, hook-set status is overwritten by the JSONL pipeline every second.

In `SessionTracker.processRecord()` (line 738), the status sync line:

```typescript
// CURRENT (broken with hooks):
session.info.status = session.stateMachine.status;

// FIXED:
if (!this.isHookActive(sessionId)) {
  session.info.status = session.stateMachine.status;
}
```

The helper method:

```typescript
/**
 * Whether hook events are actively driving state for this session.
 * Returns false if hooks have never fired or are stale (>60s since last event).
 */
private isHookActive(sessionId: string): boolean {
  if (!this.hookActiveForSession.has(sessionId)) return false;
  const lastTime = this.lastHookEventTime.get(sessionId);
  if (!lastTime) return false;
  if (Date.now() - lastTime > HOOK_STALENESS_MS) {
    // Hooks went stale — fall back to JSONL
    this.hookActiveForSession.delete(sessionId);
    this.lastHookEventTime.delete(sessionId);
    return false;
  }
  return true;
}
```

**Where the guard is applied** (3 locations in SessionTracker):

1. **`processRecord()` line 738** — main sync after every record dispatch
2. **`handleRecords()` replay detection (line 653)** — also guarded: don't override hook status with replay `DONE`
3. **`cleanupStaleSessions()` inactivity check** — respect `lastActivityAt` from hooks, not just JSONL

### Draining Pending Hook Events on Session Discovery

When a new session is created via JSONL (in `handleNewFile()`), drain any buffered hook events:

```typescript
// In handleNewFile(), after creating the session:
const pending = this.pendingHookEvents.get(sessionId);
if (pending) {
  this.pendingHookEvents.delete(sessionId);
  for (const event of pending.events) {
    this.applyHookEvent(sessionId, event);
  }
}
```

Periodic cleanup of stale buffers (in `cleanupStaleSessions()`):

```typescript
const now = Date.now();
for (const [sid, buffer] of this.pendingHookEvents) {
  if (now - buffer.firstSeen > HOOK_BUFFER_TTL_MS) {
    this.pendingHookEvents.delete(sid);
  }
}
```

### Wiring

In `SessionTracker.start()`:

```typescript
// Hook event watcher — optional, graceful if events dir doesn't exist
try {
  this.hookWatcher = new HookEventWatcher(resolvedHookEventsDir);
  this.hookEventSubscription = this.hookWatcher.onHookEvents(({ sessionId, events }) => {
    for (const event of events) {
      this.applyHookEvent(sessionId, event);
    }
  });
  this.hookWatcher.start();
} catch (err) {
  console.log(`${LOG_PREFIX.SESSION_TRACKER} Hook watcher init failed (non-fatal): ${err}`);
}
```

### Dispose Chain

In `SessionTracker.dispose()`:

```typescript
this.hookEventSubscription?.dispose();
this.hookWatcher?.dispose();
```

Both the watcher AND the event subscription must be disposed.

---

## Part 5: Hook Registration Manager

### Interface

```typescript
// src/hooks/IHookRegistrar.ts

export interface IHookRegistrar {
  /** Check if Conductor hooks are installed in Claude settings. */
  isInstalled(): Promise<boolean>;
  /** Install/update Conductor hooks in Claude settings. */
  install(): Promise<void>;
  /** Remove Conductor hooks from Claude settings. */
  uninstall(): Promise<void>;
  /** Ensure hook script exists and is up to date. */
  ensureHookScript(): Promise<void>;
}
```

### Implementation

```
src/hooks/HookRegistrar.ts

- Reads ~/.claude/settings.json
- Merges Conductor hooks into existing hooks config (non-destructive)
- Atomic write: write to settings.json.tmp, then fs.renameSync()
- Writes ~/.conductor/hook.sh with executable permissions (chmod 0o755)
- Shows VS Code notification on first install
- Verifies script hash on activation to auto-update if extension version changes
```

### Activation Flow

```
extension.activate()
    ↓
try {
  HookRegistrar.isInstalled()
    ├── yes → HookRegistrar.ensureHookScript() (update if needed)
    └── no  → HookRegistrar.install()
                → merge hooks into settings.json (atomic write)
                → write hook.sh + chmod +x
                → show notification: "Conductor hooks installed for real-time status"
} catch (err) {
  // Non-fatal: show warning, continue without hooks
  vscode.window.showWarningMessage(`Conductor hooks setup failed: ${err.message}`);
}
    ↓
HookEventWatcher.start()    (works even if install failed — may find old events)
    ↓
TranscriptWatcher.start()   (existing, unchanged)
```

**Error handling**: Hook installation failure is non-fatal. The extension continues with JSONL-only state detection. A warning notification is shown so the user knows hooks aren't active.

---

## File Changes Summary

### New Files

| File | Purpose |
|---|---|
| `src/hooks/IHookRegistrar.ts` | Interface for hook registration |
| `src/hooks/HookRegistrar.ts` | Reads/writes Claude settings.json, manages hook script |
| `src/hooks/hookScript.ts` | Hook script content as a template string |
| `src/monitoring/IHookEventWatcher.ts` | Interface for hook event watcher |
| `src/monitoring/HookEventWatcher.ts` | Watches ~/.conductor/events/, own parser (not JsonlParser) |
| `src/__tests__/HookEventWatcher.test.ts` | Tests for the watcher |
| `src/__tests__/HookRegistrar.test.ts` | Tests for hook registration |
| `src/__tests__/SessionStateMachine.bugfixes.test.ts` | Tests for the 5 bug fixes |

### Modified Files

| File | Change |
|---|---|
| `src/monitoring/SessionStateMachine.ts` | 5 bug fixes (Part 1), add `overrideStatus()` to interface and class |
| `src/monitoring/SessionTracker.ts` | Add `applyHookEvent()`, `isHookActive()`, hook buffer, status sync guard at line 738, dispose chain, pending event drain in `handleNewFile()` |
| `src/extension.ts` | Create HookRegistrar, call install on activation (try/catch) |
| `src/constants.ts` | Add `HOOK_EVENTS`, `HOOK_NOTIFICATION_TYPES`, `HOOK_EVENTS_DIR`, `HOOK_STALENESS_MS`, `HOOK_BUFFER_*` constants |
| `src/models/types.ts` | Add `HookEvent` type |

### Not Modified

| File | Why |
|---|---|
| `src/monitoring/TranscriptWatcher.ts` | Unchanged — continues watching JSONL for analytics |
| `src/monitoring/JsonlParser.ts` | NOT reused by HookEventWatcher (type field mismatch) |
| `webview-ui/**` | No UI changes — Kanban columns already map to the 4 states |
| `src/models/protocol.ts` | No new IPC messages needed — `state:full` already carries status |

---

## Implementation Order

1. **Bug fixes** (SessionStateMachine.ts) — immediate accuracy improvement, includes `overrideStatus()`
2. **Constants** — `HOOK_EVENTS`, `HOOK_NOTIFICATION_TYPES`, and other hook constants in `constants.ts`
3. **HookEvent type** in `types.ts` + **IHookEventWatcher** interface
4. **HookEventWatcher** — the watcher with its own parser + tests
5. **Hook script** (`hookScript.ts`) + **HookRegistrar** + tests
6. **SessionTracker integration** — `applyHookEvent()`, `isHookActive()`, status sync guard, pending buffer, dispose chain
7. **Extension activation** — auto-register on startup with error handling
8. **Cleanup command** — `Conductor: Uninstall Hooks` for removal

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude settings.json format changes | Defensive JSON parsing, preserve unknown keys |
| Hook script not executable (permissions) | chmod +x on install, verify on activation |
| Stale event files grow unbounded | HookEventWatcher deletes files older than 4h (matches session cleanup) |
| User has no ~/.claude/settings.json | Create with just the hooks section |
| session_id from hook doesn't match JSONL session | They use the same ID — confirmed from `transcript_path` field in hook data |
| Hook fires before JSONL discovers session | Pending event buffer (bounded, 60s TTL), drained on session creation |
| settings.json corrupted by concurrent write | Atomic write: temp file + rename |
| HookRegistrar.install() fails | Non-fatal: warning notification, extension continues with JSONL-only |
| JSONL sync overwrites hook status | `isHookActive()` guard at 3 sync points in SessionTracker |
| Hook script grep fails silently | `|| true` on all grep calls, no `set -e`, jq preferred |
| Path traversal via session_id | `tr -cd 'a-zA-Z0-9_-'` sanitization in hook script |

---

## Appendix: Review Fixes (v2)

Changes made from v1 based on staff engineer review:

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | `cancelTimers()` is private, plan calls it externally | Critical | Added `overrideStatus()` that cancels timers + sets status. Made `setStatus()` also cancel timers. `cancelTimers()` stays private. |
| 2 | `JsonlParser` silently drops hook events (requires `type` field) | Critical | HookEventWatcher uses its own parser with `e`+`ts`+`sid` validation. JsonlParser is NOT reused. |
| 3 | Hook script grep fails with `set -e`, path traversal risk | Critical | Removed `set -e`. Added `jq` with grep fallback. Added `|| true` on greps. Added session_id sanitization. |
| 4 | Hook events for new sessions silently dropped | Important | Added pending event buffer (`pendingHookEvents` map), drained in `handleNewFile()`, TTL cleanup. |
| 5 | Hook-JSONL arbitration unspecified | Important | Defined `isHookActive()` with 60s staleness. Applied at 3 sync points in SessionTracker. |
| 6 | JSONL status sync overwrites hook status every 1s | Important | Guard at `processRecord()` line 738: skip sync when `isHookActive()`. Also guarded replay detection. |
| 7 | settings.json not written atomically | Important | Temp file + `fs.renameSync()` in HookRegistrar. |
| 8 | No dispose() for HookEventWatcher | Important | Added to SessionTracker dispose chain (both watcher and event subscription). |
| 9 | `set -euo pipefail` kills script on grep miss | Nice-to-have | Removed. |
| 10 | Hook event name string literals | Nice-to-have | Added `HOOK_EVENTS` and `HOOK_NOTIFICATION_TYPES` constant objects in `constants.ts`. |
