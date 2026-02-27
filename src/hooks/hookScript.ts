/**
 * @module hookScript
 *
 * Template string for the conductor-hook.sh bash script.
 * Written to `~/.conductor/hook.sh` by {@link HookRegistrar}.
 *
 * @remarks
 * The script is invoked by Claude Code hooks with JSON on stdin.
 * It extracts the event name and session ID, then appends a minimal
 * JSON line to `~/.conductor/events/<session-id>.jsonl`.
 *
 * Uses `jq` when available (fast, robust) with a `grep` fallback.
 * Never blocks Claude — all hooks are registered as `async: true`.
 */

/** Current version of the hook script for update detection. */
export const HOOK_SCRIPT_VERSION = '2';

/**
 * The complete hook script content.
 * Written verbatim to `~/.conductor/hook.sh`.
 */
export const HOOK_SCRIPT_CONTENT = `#!/usr/bin/env bash
# Conductor hook — appends Claude Code state events to per-session event files.
# Installed by the Conductor VS Code extension. Do not edit manually.
# v${HOOK_SCRIPT_VERSION} — uses jq with grep fallback, sanitizes session_id

EVENTS_DIR="$HOME/.conductor/events"
mkdir -p "$EVENTS_DIR"

# Read stdin (Claude Code hook JSON)
INPUT="$(cat)"

# Extract fields — prefer jq, fall back to grep
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
  EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
else
  SESSION_ID=$(printf '%s' "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  EVENT=$(printf '%s' "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

# Skip if missing required fields
[ -z "$SESSION_ID" ] && exit 0
[ -z "$EVENT" ] && exit 0

# Sanitize session_id: strip anything that's not alphanumeric, dash, or underscore
SESSION_ID=$(printf '%s' "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
[ -z "$SESSION_ID" ] && exit 0

# Optional fields (only extracted for events that need them)
TOOL=""
ERR=""
NTYPE=""

if command -v jq >/dev/null 2>&1; then
  case "$EVENT" in
    PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest)
      TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty') ;;
    Notification)
      NTYPE=$(printf '%s' "$INPUT" | jq -r '.notification_type // empty') ;;
  esac
  [ "$EVENT" = "PostToolUseFailure" ] && ERR=$(printf '%s' "$INPUT" | jq -r '.error // empty')
else
  case "$EVENT" in
    PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest)
      TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true) ;;
    Notification)
      NTYPE=$(printf '%s' "$INPUT" | grep -o '"notification_type":"[^"]*"' | head -1 | cut -d'"' -f4 || true) ;;
  esac
  [ "$EVENT" = "PostToolUseFailure" ] && \\
    ERR=$(printf '%s' "$INPUT" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

# Build minimal JSON line and append
TS=$(date +%s)
LINE="{\\"e\\":\\"$EVENT\\",\\"ts\\":$TS,\\"sid\\":\\"$SESSION_ID\\""
[ -n "$TOOL" ] && LINE="$LINE,\\"tool\\":\\"$TOOL\\""
[ -n "$ERR" ] && LINE="$LINE,\\"err\\":\\"$ERR\\""
[ -n "$NTYPE" ] && LINE="$LINE,\\"ntype\\":\\"$NTYPE\\""
LINE="$LINE}"

printf '%s\\n' "$LINE" >> "$EVENTS_DIR/$SESSION_ID.jsonl"

exit 0
`;
