# Contribution Guidelines

## Before You Code

1. **Check the roadmap** in `docs/extensibility-roadmap.md`. If your change relates to a planned phase, align with that direction.
2. **Interface first**: If adding a new component, define the interface before the implementation.
3. **Tests first**: Write failing tests, then implementation. Every PR must include tests for new code.

## PR Standards

- **One concern per PR.** Don't mix feature work with refactoring.
- **Tests must pass**: `npm run test` and `npm run lint` must both pass.
- **No type duplication**: If you add a type used by both extension and webview, it goes in `src/models/types.ts` only.
- **Document new IPC messages**: Any new message type must be added to `protocol.ts` with a comment explaining when it's sent.

## Adding a New Analytics Module

1. Create `src/analytics/YourModule.ts` implementing the analytics interface pattern.
2. Add tests in `src/__tests__/YourModule.test.ts`.
3. Register in `SessionTracker` (or the future analytics registry).
4. If it produces UI data: add an IPC message type to `protocol.ts`, handle in `DashboardPanel`, and create a webview component.

## Adding a New UI Panel

1. Create `webview-ui/src/components/YourPanel.tsx`.
2. Add state slice to `dashboardStore.ts` if needed.
3. Handle the new IPC message in `useVsCodeMessage.ts`.
4. Add the panel to `Dashboard.tsx` layout.
