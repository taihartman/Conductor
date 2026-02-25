# Changelog

All notable changes to the Conductor extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
