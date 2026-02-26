# Coding Standards

## TypeScript Conventions

- **Strict mode**: `strict: true` in all `tsconfig.json` files. No `any` unless absolutely unavoidable (and justified with a comment).
- **Discriminated unions over inheritance**: Use `type` fields and union types (as in `JsonlRecord`, `ExtensionToWebviewMessage`). Avoid class hierarchies.
- **Interfaces for contracts**: Every component that could be swapped, extended, or mocked must have an interface. Prefix interfaces with `I` only when the concrete class has the same name (e.g., `IProjectScanner` / `ProjectScanner`).
- **Explicit return types**: All exported functions and public methods must have explicit return type annotations.
- **No default exports**: Use named exports everywhere for better refactoring support and grep-ability.
- **`readonly` by default**: Mark class fields `readonly` unless mutation is required.

## Naming Conventions

- **Files**: PascalCase for classes/components (`SessionTracker.ts`, `AgentCard.tsx`), camelCase for utilities/hooks (`useVsCodeMessage.ts`).
- **Interfaces**: PascalCase, descriptive nouns (`DashboardState`, `WatcherEvent`). Use `I` prefix only to disambiguate from a concrete class.
- **Types**: PascalCase for type aliases (`SessionStatus`, `JsonlRecordType`).
- **Constants**: UPPER_SNAKE_CASE for module-level constants (`IDLE_TIMEOUT_MS`, `MAX_ACTIVITIES`).
- **Private fields**: Use TypeScript `private` keyword (not `#` private fields) for consistency with existing code.

## Logging

All extension code uses **two logging channels**:

- **`console.log`** — Shows in the **Debug Console** of the host VS Code window (the one where you press F5). Use the `[Conductor:<Component>]` prefix for all console logs.
- **`outputChannel.appendLine`** — Shows in the **Output panel** of the Extension Development Host window (select "Conductor" from the dropdown).

When adding new code, include `console.log` at key lifecycle points (start, new data, state changes, errors). This makes the Debug Console the primary place to monitor the extension during development.

## Error Handling

- **Never swallow errors silently.** Log to both `console.log` and the output channel (`outputChannel.appendLine`) with context about what failed and why.
- **Fail fast at boundaries**: Validate data from external sources (JSONL files, IPC messages) early. Use type guards.
- **No try/catch around internal code** unless you have a specific recovery strategy. Let unexpected errors propagate.

## IPC Protocol Rules

- **All message types must be defined in `src/models/protocol.ts`** as part of the discriminated union. No ad-hoc message shapes.
- **Webview must use the typed protocol.** The `ExtensionToWebviewMessage` union from `protocol.ts` is the source of truth. Do not re-declare message shapes in the webview.
- **No dead protocol entries.** If a message type is defined but never sent/handled, remove it.
