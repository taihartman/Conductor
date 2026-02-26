# Session Quick Pick Design

## Summary

A single keybinding (`Cmd+Shift+;`) opens a VS Code Quick Pick listing all tracked Claude sessions. Selecting one focuses it in the Conductor dashboard, opening the dashboard if not already visible.

## Keybinding

| Platform | Binding |
|---|---|
| macOS | `Cmd+Shift+;` |
| Windows / Linux | `Ctrl+Shift+;` |

No `when` clause — the shortcut is always active when VS Code is focused.

## Command

- **ID**: `conductor.quickPickSession`
- **Title**: `Conductor: Switch Session`

## Quick Pick Item Format

```
$(bell)  my-web-app — Waiting 3m
────────────────── Active ──────────────────
$(pulse)  api-server — Working 1m
$(pulse)  data-pipeline — Thinking 30s
────────────────── Done ──────────────────
$(circle-filled)  auth-refactor — Done 12m
```

- **Status icons** (codicons, since Quick Pick does not support colored text):
  - `$(bell)` — waiting (needs input)
  - `$(alert)` — error (stuck)
  - `$(pulse)` — working / thinking
  - `$(check)` — done
  - `$(circle-filled)` — idle
- **Separator rows** (`QuickPickItemKind.Separator`) between status groups for scannability.
- Display name resolved as: `customName ?? autoName ?? sessionId`.
- Relative time since last activity (e.g. `3m`, `1h`). Compact format — no "ago" suffix.

## Sort Order (by urgency)

1. **waiting** — needs user input right now
2. **error** — stuck, needs attention
3. **working / thinking** — actively running
4. **done** — turn completed
5. **idle** — quiet

Within each group, sorted by most recent activity first.

## Session Filtering

The Quick Pick excludes sessions the user doesn't want to see:

- **Hidden sessions** (`SessionVisibilityStore`) — excluded
- **Sub-agent sessions** (`isSubAgent: true`) — excluded
- **Artifact sessions** (`isArtifact: true`) — excluded

Only top-level, visible sessions appear.

## Behavior

- Selecting a session calls `DashboardPanel.focusSession(sessionId)` (new public method — see below).
- If the dashboard panel is not open, the command calls `DashboardPanel.createOrShow()` first, then focuses.
- If no visible sessions exist, the Quick Pick shows a placeholder: "No active sessions found".

## New: DashboardPanel.focusSession()

Currently, session focusing only works via webview → extension IPC (`session:focus` message). The Quick Pick command needs to focus a session from the extension side. This requires:

1. **New public method** on `DashboardPanel`:
   ```typescript
   public focusSession(sessionId: string): void {
     this.focusedSessionId = sessionId;
     this.postActivities();
     this.postConversation();
     this.postMessage({ type: 'session:focus-command', sessionId });
   }
   ```

2. **New `ExtensionToWebviewMessage` variant** in `protocol.ts`:
   ```typescript
   | { type: 'session:focus-command'; sessionId: string }
   ```

3. **Webview handler** in `useVsCodeMessage.ts`: on receiving `session:focus-command`, call `setFocusedSession(sessionId)` in the Zustand store.

This makes programmatic session focusing a first-class capability, reusable by future features (auto-focus on launch, status bar clicks, etc.).

## Dependency Wiring

The command handler needs access to `sessionTracker`, `nameStore`, `visibilityStore`, and the ability to open/focus the dashboard. Since all commands are currently registered inline in `extension.ts:activate()` using closures over local variables, the Quick Pick command follows the same pattern:

```typescript
// In activate():
const quickPickCommand = vscode.commands.registerCommand(
  COMMANDS.QUICK_PICK_SESSION,
  () => quickPickSession(context, sessionTracker!, nameStore, visibilityStore, ...)
);
```

The `quickPickSession()` function is exported from `src/commands/quickPickSession.ts` — keeping the logic out of `activate()` for SRP, while wiring dependencies via the existing closure pattern. This establishes `src/commands/` as the directory for command handlers going forward.

## Shared Utilities

The `timeAgo()` and `getSessionDisplayName()` formatters currently live in `webview-ui/src/utils/formatters.ts` (webview-only). The command handler runs in the extension host and cannot import from `webview-ui/`.

For this feature, inline the simple logic directly in the command handler:
- Display name: `customName ?? autoName ?? sessionId` (one-liner, not worth extracting)
- Relative time: write a compact `relativeTime(date)` helper in `quickPickSession.ts`

If future extension-side code needs these, extract to `src/utils/` at that point.

## Files to Create / Modify

| File | Change |
|---|---|
| `src/constants.ts` | Add `COMMANDS.QUICK_PICK_SESSION`, `LOG_PREFIX.QUICK_PICK` |
| `package.json` | Add command + keybinding in `contributes` |
| `src/commands/quickPickSession.ts` | New file — command handler: reads sessions from SessionTracker, filters, sorts, builds Quick Pick items, calls `DashboardPanel.focusSession()` |
| `src/extension.ts` | Register the new command, pass dependencies via closure |
| `src/DashboardPanel.ts` | Add public `focusSession(sessionId)` method |
| `src/models/protocol.ts` | Add `session:focus-command` to `ExtensionToWebviewMessage` |
| `webview-ui/src/hooks/useVsCodeMessage.ts` | Handle `session:focus-command` → call `setFocusedSession()` |
| `src/__tests__/quickPickSession.test.ts` | New file — tests for sorting, filtering, display name resolution, empty state |
