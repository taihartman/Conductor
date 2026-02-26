# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension that monitors Claude Code AI agent activity in real-time. It reads JSONL transcript files from `~/.claude/projects/`, parses them incrementally, and displays session status, tool usage, and token consumption in a webview dashboard.

**Goal**: Open-source, extensible platform where contributors can add new data sources, analytics modules, and UI panels without modifying core code.

## Commands

```bash
# Install dependencies (both extension and webview)
npm install && cd webview-ui && npm install

# Build everything (extension + webview)
npm run build

# Watch mode for extension development
npm run watch

# Webview dev server with HMR (separate terminal)
cd webview-ui && npm run dev

# Run all tests
npm run test

# Watch mode tests
npm run test:watch

# Type checking
npm run lint

# Generate API docs (output: docs/api/, gitignored)
npm run docs

# Format code
npm run format

# Check formatting
npm run format:check

# Lint with ESLint
npm run lint:eslint

# Type check + ESLint combined
npm run lint:all

# Run a single test file
npx vitest run src/__tests__/JsonlParser.test.ts
```

To debug: press F5 in VS Code to launch the extension host (runs build first).

## Architecture

> **Full architecture docs**: See [`docs/architecture.md`](docs/architecture.md) for state machine diagrams, constants table, IPC protocol reference, and file naming conventions.
>
> **Keep docs in sync**: Run `/sync-architecture-docs` after structural changes to detect divergences between code and documentation.

**Dual-build system**: esbuild bundles the Node.js extension (`src/` → `dist/extension.js`), Vite bundles the React webview (`webview-ui/src/` → `webview-ui/dist/`). Separate `package.json` files isolate dependencies.

### Data Pipeline

```
~/.claude/projects/**/*.jsonl
    → ProjectScanner (discovers files)
    → TranscriptWatcher (file watcher + 1s polling fallback)
    → JsonlParser (incremental reads from byte offset)
    → SessionTracker (state machine: idle → active → waiting → idle)
    → DashboardPanel (IPC to webview)
    → React UI (Zustand store)
```

### Extension Backend (`src/`)

- **`extension.ts`** — Activation, commands (`conductor.open`, `.refresh`), status bar
- **`DashboardPanel.ts`** — Webview lifecycle, CSP-secured HTML, IPC bridge
- **`monitoring/SessionTracker.ts`** — Core orchestrator. Maps sessionId → state, processes JSONL records, emits debounced updates (100ms). Idle timeout: 30s. Max activities: 500. Replay detection: skips data >5min old on first read
- **`monitoring/SessionStateMachine.ts`** — Pure state machine for session status transitions (idle → active → waiting → stalled → idle)
- **`monitoring/ConversationBuilder.ts`** — Builds conversation turn structure from raw JSONL records
- **`monitoring/ProjectScanner.ts`** — Scans `~/.claude/projects/` for `.jsonl` files
- **`monitoring/TranscriptWatcher.ts`** — Hybrid file watcher (VS Code FileSystemWatcher + polling). Poll: 1s, scan for new files: 30s
- **`monitoring/JsonlParser.ts`** — Incremental JSONL parsing with line buffer for partial reads
- **`analytics/TokenCounter.ts`** — Token aggregation per session/model with USD cost estimation
- **`analytics/ToolStats.ts`** — Tool call metrics (count, errors, duration via tool_use/tool_result pairing)
- **`persistence/SessionNameResolver.ts`** — Resolves display names for sessions from JSONL content
- **`persistence/SessionNameStore.ts`** — Persists session display names across restarts
- **`persistence/SessionOrderStore.ts`** — Persists session ordering/pinning preferences
- **`terminal/TerminalBridge.ts`** — Bridges VS Code terminal API with the extension for agent interaction
- **`config/toolSummarizers.ts`** — Registry map for tool input summarization
- **`models/sharedConstants.ts`** — Type discriminators shared between extension and webview
- **`utils/textUtils.ts`** — Text processing utilities

### Webview UI (`webview-ui/`)

React 19 + Zustand 5 + Vite. Components receive state via Zustand store, updated by `useVsCodeMessage` hook listening to extension IPC messages.

### IPC Protocol (`src/models/protocol.ts`)

Extension → Webview: `sessions:update`, `activity:full`, `toolStats:update`, `tokens:update`
Webview → Extension: `ready`, `session:focus`, `refresh`

## Key Types (`src/models/types.ts`)

- **`JsonlRecord`** — Discriminated union: `AssistantRecord | UserRecord | SystemRecord | SummaryRecord | ProgressRecord`
- **`SessionInfo`** — Session metadata + status + token counts + `isSubAgent` flag
- **`ActivityEvent`** — Types: `tool_call`, `tool_result`, `text`, `turn_end`, `user_input`

## Testing

Tests live in `src/__tests__/`. Vitest with Node.js environment. VS Code is mocked via `src/__tests__/__mocks__/vscode.ts`. Test fixtures in `src/__tests__/fixtures/`.

## Key Design Decisions

- **Hybrid file watching**: FileSystemWatcher + polling ensures reliability across platforms
- **Incremental parsing**: Byte offset tracking avoids re-reading entire files
- **Replay detection**: Records >5min old on first read are marked historical, not live
- **Disposable pattern**: SessionTracker, DashboardPanel, TranscriptWatcher all implement `vscode.Disposable` for proper cleanup
- **Tool input summarization**: Tool inputs truncated to ~100 chars to prevent UI overflow

---

## Standards & Rules

Enforceable standards live in `.claude/rules/` and are automatically loaded by Claude Code:

| File | Scope |
|---|---|
| [`coding-standards.md`](.claude/rules/coding-standards.md) | TypeScript conventions, naming, logging, error handling, IPC protocol |
| [`testing-standards.md`](.claude/rules/testing-standards.md) | Test requirements, naming, fixtures, coverage, refactoring rule |
| [`architecture-principles.md`](.claude/rules/architecture-principles.md) | Interface-first, DI, SRP, shared types, event-driven, config over hardcoding |
| [`contribution-guidelines.md`](.claude/rules/contribution-guidelines.md) | PR standards, adding analytics modules, adding UI panels |
| [`constants-and-localization.md`](.claude/rules/constants-and-localization.md) | No inline literals — constant registries, `// inline-ok` convention |

## Planning Documents

| File | Content |
|---|---|
| [`docs/extensibility-roadmap.md`](docs/extensibility-roadmap.md) | 5-phase plugin architecture plan (interface extraction → plugin API) |
| [`docs/known-tech-debt.md`](docs/known-tech-debt.md) | Tracked technical debt items |
| [`docs/architecture.md`](docs/architecture.md) | State machine diagrams, constants table, IPC protocol reference |
