# Contributing to Claude Agent Dashboard

Thank you for your interest in contributing! This guide covers development setup, coding standards, and the PR process.

## Development Setup

### Prerequisites

- **Node.js** 20.0.0+
- **VS Code** 1.85.0+
- **Claude Code CLI** (for testing with real transcript data)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/anthropics/claude-agent-dashboard.git
cd claude-agent-dashboard

# Install extension dependencies
npm install

# Install webview dependencies
cd webview-ui && npm install && cd ..

# Build everything
npm run build

# Run tests
npm test

# Type checking
npm run lint
```

### Development Workflow

1. **Extension backend** — Run `npm run watch` in the root for incremental rebuilds
2. **Webview UI** — Run `cd webview-ui && npm run dev` in a separate terminal for HMR
3. **Debug** — Press F5 in VS Code to launch the Extension Development Host

## Coding Standards

### TypeScript

- **Strict mode** is enabled. No `any` unless justified with a comment.
- Use **discriminated unions** over class hierarchies (see `JsonlRecord`, `ExtensionToWebviewMessage`).
- All exported functions and public methods must have **explicit return types**.
- Use **named exports** everywhere — no default exports.
- Mark class fields `readonly` unless mutation is required.

### TSDoc Comments

All public APIs must have TSDoc comments. Follow these conventions:

```typescript
/**
 * Brief description of what this does.
 *
 * @remarks
 * Additional context, design decisions, or caveats.
 *
 * @param paramName - Description of the parameter
 * @returns Description of the return value
 *
 * @example
 * ```typescript
 * const result = myFunction('input');
 * ```
 */
```

### File Naming

- **PascalCase** for classes and components: `SessionTracker.ts`, `AgentCard.tsx`
- **camelCase** for utilities and hooks: `useVsCodeMessage.ts`

### Error Handling

- Never swallow errors silently — log to the output channel with context
- Validate external data (JSONL files, IPC messages) early with type guards
- No try/catch around internal code unless you have a specific recovery strategy

## Testing

Tests live in `src/__tests__/` and use [Vitest](https://vitest.dev/).

### Requirements

- Every new module must have tests
- Every public method needs at least one happy-path and one error-path test
- Test behavior, not implementation — assert on outputs and side effects
- Use the existing `src/__tests__/__mocks__/vscode.ts` mock for VS Code APIs

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Single file
npx vitest run src/__tests__/JsonlParser.test.ts
```

### Adding Test Fixtures

Place JSONL fixtures in `src/__tests__/fixtures/`. Name them descriptively:
`assistant-with-tool-use.jsonl`, `multi-session-replay.jsonl`, etc.

## Pull Request Process

### Before You Code

1. Check [CLAUDE.md](CLAUDE.md) for the extensibility roadmap — align with planned phases
2. Define interfaces before implementations
3. Write failing tests first, then implement

### PR Checklist

- [ ] Description includes summary of changes and motivation
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] New code has TSDoc comments on all public APIs
- [ ] No type duplication between extension and webview
- [ ] New IPC messages are defined in `src/models/protocol.ts`
- [ ] One concern per PR — don't mix features with refactoring

### Commit Messages

Use conventional commit style:

```
feat: add memory usage tracking module
fix: handle missing timestamp in progress records
docs: add TSDoc to TokenCounter public methods
refactor: extract RecordProcessor from SessionTracker
test: add edge case tests for JsonlParser line buffer
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design, and [CLAUDE.md](CLAUDE.md) for the extensibility roadmap and known technical debt.
