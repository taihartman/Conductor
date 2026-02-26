# Known Technical Debt

Track these when contributing. PRs that address debt items are welcome.

- [ ] **Duplicate types in webview** — `webview-ui/src/store/dashboardStore.ts` re-declares types from `src/models/types.ts`. Must be unified via shared types package or path alias.
- [x] **Hardcoded tool summarization** — Resolved: extracted to `src/config/toolSummarizers.ts` with a `TOOL_SUMMARIZERS` registry map.
- [ ] **Hardcoded model pricing** — `TokenCounter.MODEL_PRICING` requires code changes when pricing changes. Move to external config or VS Code settings.
- [ ] **Dead `config:theme` protocol message** — Defined in `protocol.ts` but never sent or handled. Remove it.
- [ ] **Loose typing at IPC boundary** — `useVsCodeMessage.ts` uses a local `ExtensionMessage` interface instead of the typed `ExtensionToWebviewMessage` union. Fix to use shared protocol types.
- [ ] **No webview dev stub** — Running `npm run dev` in `webview-ui/` crashes because `acquireVsCodeApi` is undefined in browser. Add a dev-mode mock.
- [x] **Session focus state duplication** — Resolved: `SessionTracker` no longer stores `focusedSessionId`. `DashboardPanel` owns focus state.
- [ ] **Missing tests** — `TranscriptWatcher`, `ToolStats`, `DashboardPanel`, all React components, and the IPC boundary lack tests.
- [ ] **Hardcoded asset paths** — `DashboardPanel.getHtml()` hardcodes `assets/index.js` / `assets/index.css`. Consider reading a manifest file.
