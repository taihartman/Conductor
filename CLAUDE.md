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

- **`extension.ts`** — Activation, commands (`claudeAgentDashboard.open`, `.refresh`), status bar
- **`DashboardPanel.ts`** — Webview lifecycle, CSP-secured HTML, IPC bridge
- **`monitoring/SessionTracker.ts`** — Core orchestrator. Maps sessionId → state, processes JSONL records, emits debounced updates (100ms). Idle timeout: 30s. Max activities: 500. Replay detection: skips data >5min old on first read
- **`monitoring/ProjectScanner.ts`** — Scans `~/.claude/projects/` for `.jsonl` files
- **`monitoring/TranscriptWatcher.ts`** — Hybrid file watcher (VS Code FileSystemWatcher + polling). Poll: 1s, scan for new files: 30s
- **`monitoring/JsonlParser.ts`** — Incremental JSONL parsing with line buffer for partial reads
- **`analytics/TokenCounter.ts`** — Token aggregation per session/model with USD cost estimation
- **`analytics/ToolStats.ts`** — Tool call metrics (count, errors, duration via tool_use/tool_result pairing)

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

### Testing Standards

- **Every new module must have tests.** No PR merges without tests for new code.
- **Test behavior, not implementation.** Assert on outputs and side effects, not internal state.
- **Use the existing `vscode.ts` mock** for anything that imports `vscode`. Extend it when needed — don't create alternative mocks.
- **Test file naming**: `src/__tests__/<ModuleName>.test.ts`
- **Fixture files**: `src/__tests__/fixtures/` — add new JSONL fixtures for new record types or edge cases.
- **Minimum coverage for new code**: Every public method must have at least one happy-path and one error-path test.
- **When refactoring**: Write tests for the existing behavior FIRST, then refactor. Tests are the safety net.

## Key Design Decisions

- **Hybrid file watching**: FileSystemWatcher + polling ensures reliability across platforms
- **Incremental parsing**: Byte offset tracking avoids re-reading entire files
- **Replay detection**: Records >5min old on first read are marked historical, not live
- **Disposable pattern**: SessionTracker, DashboardPanel, TranscriptWatcher all implement `vscode.Disposable` for proper cleanup
- **Tool input summarization**: Tool inputs truncated to ~100 chars to prevent UI overflow

---

## Coding Standards

### TypeScript Conventions

- **Strict mode**: `strict: true` in all `tsconfig.json` files. No `any` unless absolutely unavoidable (and justified with a comment).
- **Discriminated unions over inheritance**: Use `type` fields and union types (as in `JsonlRecord`, `ExtensionToWebviewMessage`). Avoid class hierarchies.
- **Interfaces for contracts**: Every component that could be swapped, extended, or mocked must have an interface. Prefix interfaces with `I` only when the concrete class has the same name (e.g., `IProjectScanner` / `ProjectScanner`).
- **Explicit return types**: All exported functions and public methods must have explicit return type annotations.
- **No default exports**: Use named exports everywhere for better refactoring support and grep-ability.
- **`readonly` by default**: Mark class fields `readonly` unless mutation is required.

### Naming Conventions

- **Files**: PascalCase for classes/components (`SessionTracker.ts`, `AgentCard.tsx`), camelCase for utilities/hooks (`useVsCodeMessage.ts`).
- **Interfaces**: PascalCase, descriptive nouns (`DashboardState`, `WatcherEvent`). Use `I` prefix only to disambiguate from a concrete class.
- **Types**: PascalCase for type aliases (`SessionStatus`, `JsonlRecordType`).
- **Constants**: UPPER_SNAKE_CASE for module-level constants (`IDLE_TIMEOUT_MS`, `MAX_ACTIVITIES`).
- **Private fields**: Use TypeScript `private` keyword (not `#` private fields) for consistency with existing code.

### Logging

All extension code uses **two logging channels**:

- **`console.log`** — Shows in the **Debug Console** of the host VS Code window (the one where you press F5). Use the `[ClaudeDashboard:<Component>]` prefix for all console logs.
- **`outputChannel.appendLine`** — Shows in the **Output panel** of the Extension Development Host window (select "Claude Agent Dashboard" from the dropdown).

When adding new code, include `console.log` at key lifecycle points (start, new data, state changes, errors). This makes the Debug Console the primary place to monitor the extension during development.

### Error Handling

- **Never swallow errors silently.** Log to both `console.log` and the output channel (`outputChannel.appendLine`) with context about what failed and why.
- **Fail fast at boundaries**: Validate data from external sources (JSONL files, IPC messages) early. Use type guards.
- **No try/catch around internal code** unless you have a specific recovery strategy. Let unexpected errors propagate.

### IPC Protocol Rules

- **All message types must be defined in `src/models/protocol.ts`** as part of the discriminated union. No ad-hoc message shapes.
- **Webview must use the typed protocol.** The `ExtensionToWebviewMessage` union from `protocol.ts` is the source of truth. Do not re-declare message shapes in the webview.
- **No dead protocol entries.** If a message type is defined but never sent/handled, remove it.

---

## Architecture Principles

These principles guide all new development and refactoring work.

### 1. Interface-First Design

Every major component must implement an interface. This enables:
- Swapping implementations (e.g., different data sources)
- Testing with mocks
- Future plugin architecture

```typescript
// Good: interface defined, implementation separate
export interface IProjectScanner {
  scanSessionFiles(): SessionFile[];
}
export class ProjectScanner implements IProjectScanner { ... }

// Bad: concrete class with no contract
export class ProjectScanner { ... }
```

### 2. Dependency Injection

Components receive their dependencies through constructors, not by instantiating them internally. This is the foundation for extensibility.

```typescript
// Good: dependencies injected
constructor(scanner: IProjectScanner, tokenCounter: ITokenCounter) { ... }

// Bad: dependencies created internally
constructor() {
  this.scanner = new ProjectScanner();
  this.tokenCounter = new TokenCounter();
}
```

### 3. Single Responsibility

Each class should have one reason to change. When a class handles multiple concerns (watching + parsing + state management + analytics), extract focused collaborators.

### 4. Shared Types, Separate Builds

Types shared between extension and webview (`SessionInfo`, `ActivityEvent`, etc.) must be defined in ONE place: `src/models/types.ts`. The webview build should reference these via a path alias or shared package — never duplicate type definitions.

### 5. Event-Driven Extension Points

Use VS Code's `EventEmitter` pattern for extension points. Components emit events; consumers subscribe. This allows multiple listeners without the emitter knowing about them.

```typescript
// Good: event emitter pattern
private readonly _onRecordProcessed = new vscode.EventEmitter<ProcessedRecord>();
public readonly onRecordProcessed = this._onRecordProcessed.event;

// Bad: direct callback
constructor(private readonly onRecord: (record: JsonlRecord) => void) { ... }
```

### 6. Configuration Over Hardcoding

Values that users or contributors might want to change should be configurable:
- Model pricing → VS Code settings or external config
- Tool summarization → registry/map pattern, not switch statements
- Polling intervals → constants with VS Code settings override
- File paths → configurable base directory

---

## Extensibility Roadmap

The following refactoring work is planned to support a plugin architecture. Contributors should follow these patterns in all new code.

### Phase 1: Interface Extraction (Current Priority)

Extract interfaces for all major components:

| Component | Interface | Purpose |
|---|---|---|
| `ProjectScanner` | `IProjectScanner` | Allows alternative file discovery strategies |
| `JsonlParser` | `IRecordParser` | Allows parsing different transcript formats |
| `TranscriptWatcher` | `ITranscriptWatcher` | Allows alternative watching strategies |
| `TokenCounter` | `ITokenCounter` | Allows custom cost models / pricing sources |
| `ToolStats` | `IToolStats` | Allows custom analytics modules |
| `SessionTracker` | `ISessionTracker` | Allows alternative orchestration strategies |

### Phase 2: SessionTracker Decomposition

`SessionTracker` is currently a god class (~478 lines) handling:
1. File watching orchestration → extract to a coordinator
2. Record processing (switch on record type) → extract to `RecordProcessor`
3. Session state machine → extract to `SessionStateMachine`
4. Activity buffering → extract to `ActivityBuffer`
5. Analytics delegation → keep as composed collaborators

Target: Each extracted class <150 lines, single responsibility, owns one concern.

### Phase 3: Analytics Module Registry

Replace hardcoded analytics with a registry pattern:

```typescript
interface IAnalyticsModule {
  id: string;
  processRecord(sessionId: string, record: JsonlRecord): void;
  getState(): unknown;
  dispose(): void;
}

// Register built-in modules
registry.register(new TokenCounter());
registry.register(new ToolStats());

// Third-party modules can register too
registry.register(new CustomMemoryTracker());
```

### Phase 4: UI Panel Registry

Allow new webview panels to be contributed:

```typescript
interface IPanelContribution {
  id: string;
  title: string;
  component: React.ComponentType<PanelProps>;
  stateSelector: (state: DashboardState) => unknown;
}
```

### Phase 5: Plugin API

Formal plugin manifest and lifecycle, building on all previous phases:
- Plugin discovery and loading
- API surface versioning
- Lifecycle hooks (activate, deactivate)
- Contribution points (data sources, analytics, UI panels, commands)

---

## Known Technical Debt

Track these when contributing. PRs that address debt items are welcome.

- [ ] **Duplicate types in webview** — `webview-ui/src/store/dashboardStore.ts` re-declares types from `src/models/types.ts`. Must be unified via shared types package or path alias.
- [ ] **Hardcoded tool summarization** — `SessionTracker.summarizeToolInput()` uses a switch over 9 tool names. New tools produce empty summaries. Convert to a configurable map/registry.
- [ ] **Hardcoded model pricing** — `TokenCounter.MODEL_PRICING` requires code changes when pricing changes. Move to external config or VS Code settings.
- [ ] **Dead `config:theme` protocol message** — Defined in `protocol.ts` but never sent or handled. Remove it.
- [ ] **Loose typing at IPC boundary** — `useVsCodeMessage.ts` uses a local `ExtensionMessage` interface instead of the typed `ExtensionToWebviewMessage` union. Fix to use shared protocol types.
- [ ] **No webview dev stub** — Running `npm run dev` in `webview-ui/` crashes because `acquireVsCodeApi` is undefined in browser. Add a dev-mode mock.
- [ ] **Session focus state duplication** — `focusedSessionId` lives in both `SessionTracker` and `dashboardStore`. Can drift. Single-source it.
- [ ] **Missing tests** — `ProjectScanner`, `TranscriptWatcher`, `SessionTracker`, `ToolStats`, `DashboardPanel`, all React components, and the IPC boundary lack tests.
- [ ] **Hardcoded asset paths** — `DashboardPanel.getHtml()` hardcodes `assets/index.js` / `assets/index.css`. These must match Vite output config exactly. Consider reading a manifest file.

---

## Contribution Guidelines

### Before You Code

1. **Check the roadmap** above. If your change relates to a planned phase, align with that direction.
2. **Interface first**: If adding a new component, define the interface before the implementation.
3. **Tests first**: Write failing tests, then implementation. Every PR must include tests for new code.

### PR Standards

- **One concern per PR.** Don't mix feature work with refactoring.
- **Tests must pass**: `npm run test` and `npm run lint` must both pass.
- **No type duplication**: If you add a type used by both extension and webview, it goes in `src/models/types.ts` only.
- **Document new IPC messages**: Any new message type must be added to `protocol.ts` with a comment explaining when it's sent.

### Adding a New Analytics Module

1. Create `src/analytics/YourModule.ts` implementing the analytics interface pattern.
2. Add tests in `src/__tests__/YourModule.test.ts`.
3. Register in `SessionTracker` (or the future analytics registry).
4. If it produces UI data: add an IPC message type to `protocol.ts`, handle in `DashboardPanel`, and create a webview component.

### Adding a New UI Panel

1. Create `webview-ui/src/components/YourPanel.tsx`.
2. Add state slice to `dashboardStore.ts` if needed.
3. Handle the new IPC message in `useVsCodeMessage.ts`.
4. Add the panel to `Dashboard.tsx` layout.
