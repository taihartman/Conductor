# Changelog

All notable changes to the Conductor extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-03-02

### Added

- Tiling workspace: split the dashboard into multiple panels to monitor several sessions side-by-side
- Saved tile layout presets: name and reuse custom panel arrangements
- Usage analytics tab with token/cost breakdowns by model and Peak Hours chart
- Session history tab with resume support for past sessions
- Kanban board view for session overview with configurable sort orders
- Embedded terminal (xterm.js) for Conductor-launched sessions with PTY routing
- Auto-reconnect service: automatically re-adopts reconnected terminals after a reload
- Keyboard navigation for session cards (Cmd+Shift+Arrow + Enter keybindings)
- Session visibility system (hide/unhide) with a dedicated Hidden tab
- Session drag-and-drop reorder
- Settings drawer with auto-hide patterns and help section
- Launch mode split-button (default, yolo, remote) with persisted preference
- Session renaming via inline double-click edit
- Zen mode: auto-enters a focused meditation screen after 5 minutes of inactivity
- Auto-names sessions from the first user prompt or plan file titles
- Renders `AskUserQuestion` options as clickable buttons in the chat input
- Session merging: continuation sessions sharing the same slug and CWD are grouped

### Fixed

- Session discovery no longer auto-scopes to the current VS Code workspace — all `~/.claude/projects/` sessions are shown by default (configure `conductor.additionalWorkspaces` to narrow scope)
- Empty state now shows the actual monitored path(s) instead of always displaying `~/.claude/projects/`
- Garbled terminal output on rapid session switching
- Terminal keyboard navigation: auto-focus on mount, correct PTY routing for artifact sessions
- Session status no longer sticks on WORKING after turn completion
- PTY input uses carriage return (`\r`) for correct line handling
- Cross-session activity eviction: per-session storage prevents one session from evicting another's events

## [0.1.0] - 2025-02-25

### Added

- Real-time session monitoring with live status updates (active, idle, waiting)
- Sub-agent tracking with hierarchical parent-child session view
- Tool usage analytics: call counts, error rates, average duration per tool
- Token consumption tracking with per-model USD cost estimates
- Activity feed with tool calls, text output, and user input events
- Incremental JSONL parsing with byte-offset tracking
- Hybrid file watching (VS Code FileSystemWatcher + 1s polling fallback)
- Replay detection: records older than 5 minutes on first read marked as historical
- Stale session cleanup after 4 hours of inactivity
- Status bar item for quick dashboard access
- CSP-secured webview with React 19 + Zustand 5 frontend
