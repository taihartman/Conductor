# Architecture Principles

These principles guide all new development and refactoring work.

## 1. Interface-First Design

Every major component must implement an interface. This enables swapping implementations, testing with mocks, and the future plugin architecture.

```typescript
export interface IProjectScanner {
  scanSessionFiles(): SessionFile[];
}
export class ProjectScanner implements IProjectScanner { ... }
```

## 2. Dependency Injection

Components receive their dependencies through constructors, not by instantiating them internally. This is the foundation for extensibility.

```typescript
constructor(scanner: IProjectScanner, tokenCounter: ITokenCounter) { ... }
```

## 3. Single Responsibility

Each class should have one reason to change. When a class handles multiple concerns (watching + parsing + state management + analytics), extract focused collaborators.

## 4. Shared Types, Separate Builds

Types shared between extension and webview (`SessionInfo`, `ActivityEvent`, etc.) must be defined in ONE place: `src/models/types.ts`. The webview build should reference these via a path alias or shared package — never duplicate type definitions.

## 5. Event-Driven Extension Points

Use VS Code's `EventEmitter` pattern for extension points. Components emit events; consumers subscribe. This allows multiple listeners without the emitter knowing about them.

```typescript
private readonly _onRecordProcessed = new vscode.EventEmitter<ProcessedRecord>();
public readonly onRecordProcessed = this._onRecordProcessed.event;
```

## 6. Configuration Over Hardcoding

Values that users or contributors might want to change should be configurable:
- Model pricing → VS Code settings or external config
- Tool summarization → registry/map pattern, not switch statements
- Polling intervals → constants with VS Code settings override
- File paths → configurable base directory
