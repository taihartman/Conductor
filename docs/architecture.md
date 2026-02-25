# Architecture

Detailed technical documentation for the Conductor extension internals.

## System Overview

The extension reads JSONL transcript files produced by Claude Code sessions, processes them through a pipeline, and renders live dashboard state in a VS Code webview.

```
~/.claude/projects/**/*.jsonl
    → ProjectScanner (discovers files)
    → TranscriptWatcher (file watcher + 1s polling fallback)
    → JsonlParser (incremental reads from byte offset)
    → SessionTracker (state machine: idle → active → waiting → idle)
    → DashboardPanel (IPC to webview)
    → React UI (Zustand store)
```

## File Layout

### Extension Backend (`src/`)

| File | Responsibility |
|------|---------------|
| `extension.ts` | Activation, commands (`conductor.open`, `.refresh`), status bar |
| `DashboardPanel.ts` | Webview lifecycle, CSP-secured HTML, IPC bridge (singleton) |
| `monitoring/SessionTracker.ts` | Core orchestrator — maps sessionId → state, processes records, emits updates |
| `monitoring/ProjectScanner.ts` | Scans `~/.claude/projects/` for `.jsonl` files |
| `monitoring/TranscriptWatcher.ts` | Hybrid file watcher (FileSystemWatcher + polling) |
| `monitoring/JsonlParser.ts` | Incremental JSONL parsing with line buffer for partial reads |
| `analytics/TokenCounter.ts` | Token aggregation per session/model with USD cost estimation |
| `analytics/ToolStats.ts` | Tool call metrics (count, errors, duration via tool_use/tool_result pairing) |
| `models/types.ts` | All shared domain types (single source of truth) |
| `models/protocol.ts` | IPC message contracts (discriminated unions) |

### Webview UI (`webview-ui/`)

React 19 + Zustand 5 + Vite. Components receive state via Zustand store, updated by `useVsCodeMessage` hook listening to extension IPC messages.

| File | Responsibility |
|------|---------------|
| `src/components/Dashboard.tsx` | Main layout, session list + activity feed |
| `src/components/AgentCard.tsx` | Individual session card with status, tokens, tools |
| `src/store/dashboardStore.ts` | Zustand store for dashboard state |
| `src/hooks/useVsCodeMessage.ts` | IPC message listener hook |

## Session State Machine

Each session independently tracks its state:

```
                 user input / tool call
    ┌───────┐ ──────────────────────────> ┌────────┐
    │  IDLE │                              │ ACTIVE │
    └───────┘ <────────────────────────── └────────┘
                 turn_duration system       │    ▲
                 record OR idle timeout     │    │
                 (IDLE_TIMEOUT_MS=30s)      │    │
                                            ▼    │
                                          ┌─────────┐
                                          │ WAITING │
                                          └─────────┘
                                       AskUserQuestion
                                          tool call
```

### State Transitions

| From | To | Trigger |
|------|----|---------|
| `idle` | `active` | User input text, tool result, or progress record |
| `active` | `waiting` | Assistant emits `AskUserQuestion` tool call |
| `active` | `idle` | `system` record with `subtype: 'turn_duration'` |
| `active` | `idle` | `end_turn` stop reason + no new data for `IDLE_TIMEOUT_MS` (30s) |
| `waiting` | `active` | User provides input (next user record with text) |

### Replay Detection

On the first read of a file, if the most recent record's timestamp is older than 5 minutes, the session is forced to `idle`. This prevents historical sessions from appearing as active when the extension starts up.

## Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `IDLE_TIMEOUT_MS` | 30,000 ms | `SessionTracker.ts` | Fallback idle detection after `end_turn` |
| `MAX_ACTIVITIES` | 500 | `SessionTracker.ts` | Activity buffer cap (FIFO eviction) |
| `STALE_SESSION_MS` | 4 hours | `SessionTracker.ts` | Idle sessions older than this are cleaned up |
| `CLEANUP_INTERVAL_MS` | 5 minutes | `SessionTracker.ts` | Stale session cleanup sweep interval |
| `SCAN_INTERVAL_MS` | 30,000 ms | `TranscriptWatcher.ts` | Periodic file system scan for new sessions |
| `POLL_INTERVAL_MS` | 1,000 ms | `TranscriptWatcher.ts` | Poll interval for reading new data from tracked files |
| `MAX_AGE_MS` | 4 hours | `TranscriptWatcher.ts` | Maximum file age for inclusion in scans |

## IPC Protocol

### Extension → Webview

| Message Type | Payload | When Sent |
|-------------|---------|-----------|
| `sessions:update` | `SessionInfo[]` | On every state change (debounced 100ms) |
| `activity:full` | `ActivityEvent[]` | On every state change (last 200 events) |
| `toolStats:update` | `ToolStatEntry[]` | On every state change |
| `tokens:update` | `TokenSummary[]` | On every state change |
| `config:theme` | `'dark' \| 'light'` | **Dead entry** — defined but never sent (tech debt) |

### Webview → Extension

| Message Type | Payload | When Sent |
|-------------|---------|-----------|
| `ready` | (none) | Webview mounted, requesting initial state |
| `session:focus` | `sessionId: string` | User selected a session |
| `refresh` | (none) | User clicked refresh button |

## File Naming Conventions

### Transcript Files

- **Parent sessions**: `<uuid>.jsonl` (e.g., `31df1d8d-40ca-4604-9db8-f02b4836e43f.jsonl`)
- **Sub-agent sessions**: `agent-<uuid>.jsonl` or located in `<parent-uuid>/subagents/<uuid>.jsonl`
- Sub-agents are identified by the `agent-` filename prefix OR by being in a `subagents/` directory

### Project Directories

Claude Code stores transcripts in `~/.claude/projects/<encoded-path>/`. The encoded path replaces `/` with `-` in the absolute project directory path.

## Token Pricing

Cost estimates use hardcoded rates in `TokenCounter.ts`:

| Model | Input/M | Output/M | Cache Read Discount | Cache Create Multiplier |
|-------|---------|----------|--------------------|-----------------------|
| `claude-opus-4-6` | $15.00 | $75.00 | 0.1 (10%) | 1.25 (125%) |
| `claude-sonnet-4-6` | $3.00 | $15.00 | 0.1 (10%) | 1.25 (125%) |
| `claude-haiku-4-5` | $0.80 | $4.00 | 0.1 (10%) | 1.25 (125%) |

Model resolution: exact match → partial string match → family detection (opus/sonnet/haiku) → default to Sonnet.

## Hybrid File Watching Strategy

1. **VS Code FileSystemWatcher** — watches `~/.claude/projects/**/*.jsonl` for `onDidCreate` events. Provides instant notification of new files.
2. **Polling (1s)** — reads tracked files incrementally via `JsonlParser.parseIncremental()`. Ensures data is captured even when file change events are missed.
3. **Periodic scan (30s)** — re-scans the projects directory to discover files that may have been missed by the watcher (e.g., created before the extension activated).

If the FileSystemWatcher fails to initialize (e.g., unsupported filesystem), the extension falls back to polling-only mode.

## Incremental Parsing

`JsonlParser` maintains per-file state:
- **Byte offset** — position of the last successful read, stored in `TranscriptWatcher.offsets`
- **Line buffer** — holds partial lines from incomplete reads (e.g., when a write is in progress)

On each poll:
1. Check if file size exceeds current offset
2. Read new bytes from the offset
3. Prepend the line buffer to the new chunk
4. Split on newlines; hold the last incomplete line in the buffer
5. Parse each complete line as JSON; skip malformed lines silently
6. Return parsed records and the new offset

## Sub-Agent Relationship Tracking

Sub-agents are linked to parents through two mechanisms:

1. **Directory structure**: Files in `<parent-uuid>/subagents/` have `parentSessionId` set to the parent UUID directory name.
2. **JSONL `sessionId` field**: When a sub-agent record contains a `sessionId` different from its own file-derived ID, it's used to link back to the parent.

In `getState()`, sub-agents are nested under their parent's `childAgents` array. Orphaned sub-agents (no known parent) appear at the top level.
