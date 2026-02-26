# Extensibility Roadmap

The following refactoring work is planned to support a plugin architecture. Contributors should follow these patterns in all new code.

## Phase 1: Interface Extraction (Current Priority)

Extract interfaces for all major components:

| Component | Interface | Purpose |
|---|---|---|
| `ProjectScanner` | `IProjectScanner` | Allows alternative file discovery strategies |
| `JsonlParser` | `IRecordParser` | Allows parsing different transcript formats |
| `TranscriptWatcher` | `ITranscriptWatcher` | Allows alternative watching strategies |
| `TokenCounter` | `ITokenCounter` | Allows custom cost models / pricing sources |
| `ToolStats` | `IToolStats` | Allows custom analytics modules |
| `SessionTracker` | `ISessionTracker` | Allows alternative orchestration strategies |

## Phase 2: SessionTracker Decomposition

`SessionTracker` is currently a god class handling:
1. File watching orchestration → extract to a coordinator
2. Record processing (switch on record type) → extract to `RecordProcessor`
3. Session state machine → extract to `SessionStateMachine`
4. Activity buffering → extract to `ActivityBuffer`
5. Analytics delegation → keep as composed collaborators

Target: Each extracted class <150 lines, single responsibility, owns one concern.

## Phase 3: Analytics Module Registry

Replace hardcoded analytics with a registry pattern:

```typescript
interface IAnalyticsModule {
  id: string;
  processRecord(sessionId: string, record: JsonlRecord): void;
  getState(): unknown;
  dispose(): void;
}

registry.register(new TokenCounter());
registry.register(new ToolStats());
registry.register(new CustomMemoryTracker()); // third-party
```

## Phase 4: UI Panel Registry

Allow new webview panels to be contributed:

```typescript
interface IPanelContribution {
  id: string;
  title: string;
  component: React.ComponentType<PanelProps>;
  stateSelector: (state: DashboardState) => unknown;
}
```

## Phase 5: Plugin API

Formal plugin manifest and lifecycle, building on all previous phases:
- Plugin discovery and loading
- API surface versioning
- Lifecycle hooks (activate, deactivate)
- Contribution points (data sources, analytics, UI panels, commands)
