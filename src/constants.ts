/** Name shown in the VS Code Output panel dropdown. */
export const OUTPUT_CHANNEL_NAME = 'Conductor';
/** Status bar item text (includes a codicon pulse icon). */
export const STATUS_BAR_TEXT = '$(pulse) Conductor';
/** Tooltip shown on hover over the status bar item. */
export const STATUS_BAR_TOOLTIP = 'Open Conductor';
/** Title displayed in the webview panel tab. */
export const PANEL_TITLE = 'Conductor';

/** VS Code command identifiers (must match `contributes.commands` in package.json). */
export const COMMANDS = {
  OPEN: 'conductor.open',
  REFRESH: 'conductor.refresh',
  LAUNCH_SESSION: 'conductor.launchSession',
  QUICK_PICK_SESSION: 'conductor.quickPickSession',
  NAV_UP: 'conductor.navUp',
  NAV_DOWN: 'conductor.navDown',
  NAV_LEFT: 'conductor.navLeft',
  NAV_RIGHT: 'conductor.navRight',
  NAV_SELECT: 'conductor.navSelect',
} as const;

/** VS Code `when`-clause context keys managed by the extension. */
export const CONTEXT_KEYS = {
  PANEL_FOCUSED: 'conductor.panelFocused',
  KEYBOARD_NAV_ACTIVE: 'conductor.keyboardNavActive',
} as const;

/** Structured log prefixes for Debug Console output. */
export const LOG_PREFIX = {
  EXTENSION: '[Conductor]',
  PANEL: '[Conductor:Panel]',
  SESSION_TRACKER: '[Conductor:SessionTracker]',
  WATCHER: '[Conductor:Watcher]',
  SCANNER: '[Conductor:Scanner]',
  NAME_STORE: '[Conductor:NameStore]',
  ORDER_STORE: '[Conductor:OrderStore]',
  VISIBILITY_STORE: '[Conductor:VisibilityStore]',
  SESSION_LAUNCHER: '[Conductor:SessionLauncher]',
  PTY_BRIDGE: '[Conductor:PtyBridge]',
  CONDUCTOR_PSEUDOTERMINAL: '[Conductor:Pseudoterminal]',
  LAUNCHED_STORE: '[Conductor:LaunchedStore]',
  AUTO_RECONNECT: '[Conductor:AutoReconnect]',
  PROCESS_DISCOVERY: '[Conductor:ProcessDiscovery]',
  QUICK_PICK: '[Conductor:QuickPick]',
  HISTORY_STORE: '[Conductor:HistoryStore]',
  HISTORY_SERVICE: '[Conductor:HistoryService]',
  HOOK_REGISTRAR: '[Conductor:HookRegistrar]',
  HOOK_WATCHER: '[Conductor:HookWatcher]',
  USAGE_READER: '[Conductor:UsageReader]',
} as const;

/** Path segments used to locate Claude transcript files on disk. */
export const FS_PATHS = {
  CLAUDE_DIR: '.claude',
  PROJECTS_DIR: 'projects',
  SUBAGENTS_DIR: 'subagents',
  PLANS_DIR: 'plans',
  JSONL_EXT: '.jsonl',
  AGENT_PREFIX: 'agent-',
  /** Filename for the Claude Code daily usage stats cache. */
  STATS_CACHE_FILE: 'stats-cache.json',
} as const;

/** Character limits for truncating text in activity events and tool summaries. */
export const TRUNCATION = {
  TEXT_MAX: 200,
  DESCRIPTION_MAX: 100,
  BASH_COMMAND_MAX: 100,
  URL_MAX: 80,
  ERROR_MESSAGE_MAX: 200,
  SESSION_NAME_MAX: 100,
  CONVERSATION_TEXT_MAX: 8000,
  TOOL_INPUT_MAX: 2000,
  TOOL_OUTPUT_MAX: 4000,
  /** Max length for tool approval description in overview card. */
  TOOL_APPROVAL_DESC_MAX: 80,
} as const;

/** Maximum conversation turns stored per session (FIFO eviction). */
export const MAX_CONVERSATION_TURNS_PER_SESSION = 500;

/** VS Code setting keys (must match `contributes.configuration` in package.json). */
export const SETTINGS = {
  ADDITIONAL_WORKSPACES: 'conductor.additionalWorkspaces',
  /** Shell command used to launch Claude Code sessions. */
  LAUNCH_COMMAND: 'conductor.launchCommand',
  /** User-defined substring patterns for auto-hiding sessions. */
  AUTO_HIDE_PATTERNS: 'conductor.autoHidePatterns',
} as const;

/** Terminal detection patterns for auto-linking Claude Code terminals. */
export const TERMINAL_DETECTION = {
  /** Substrings to match against terminal names (case-insensitive). */
  NAME_PATTERNS: ['claude'],
} as const;

/** PTY / terminal mode configuration. */
export const PTY = {
  /** Ring buffer size in bytes for webview reconnect replay. */
  RING_BUFFER_SIZE: 102400,
  /** Display name for the VS Code terminal created by SessionLauncher. */
  TERMINAL_NAME: 'Claude (Conductor)',
  /** Display name for VS Code terminals created by adopting an external session. */
  RESUMED_TERMINAL_NAME: 'Claude (Resumed)',
  /**
   * Carriage return sent after user input to simulate pressing Enter.
   * PTYs expect `\r` (CR) — NOT `\n` (LF). Using `\n` appends a line feed
   * that the terminal won't interpret as "submit".
   */
  INPUT_SUBMIT: '\r',
  /** Default column count for node-pty spawn. */
  DEFAULT_COLS: 120,
  /** Default row count for node-pty spawn. */
  DEFAULT_ROWS: 30,
  /** TERM environment variable for node-pty spawn. */
  TERM_ENV: 'xterm-256color',
} as const;

/** VS Code globalState keys for persistent storage. */
export const STORAGE_KEYS = {
  /** sessionId → customName mapping for user-defined session labels. */
  SESSION_NAMES: 'conductor.sessionNames',
} as const;

/** VS Code workspaceState keys for per-workspace persistent storage. */
export const WORKSPACE_STATE_KEYS = {
  /** Ordered list of session IDs representing the user's custom card order. */
  SESSION_ORDER: 'conductor.sessionOrder',
  /** Set of session IDs manually hidden by the user. */
  HIDDEN_SESSIONS: 'conductor.hiddenSessions',
  /** Set of artifact session IDs the user explicitly unhid. */
  FORCE_SHOWN_SESSIONS: 'conductor.forceShownSessions',
  /** Session IDs launched/adopted by Conductor, mapped to save timestamp. */
  LAUNCHED_SESSIONS: 'conductor.launchedSessions',
  /** Last-used launch mode for the split button (per-workspace default). */
  LAUNCH_MODE: 'conductor.launchMode',
  /** Map of sessionId → LaunchMode for Conductor-launched sessions (survives restarts). */
  LAUNCHED_SESSION_MODES: 'conductor.launchedSessionModes',
  /** Map of sessionId → HistoryEntryMeta for session history browsing. */
  SESSION_HISTORY: 'conductor.sessionHistory',
} as const;

/** Timing values (ms) for session state transitions. */
export const TIMING = {
  /**
   * Fallback delay before marking a text-only turn as done when neither
   * `stop_hook_summary` nor `turn_duration` system records arrive.
   * 5s is long enough to avoid false positives from mid-turn text-then-tool
   * sequences (typically 1–4s gap), short enough to feel responsive.
   */
  INTERMISSION_MS: 5_000,
  /**
   * Interval for polling after a session launch to discover the JSONL file.
   * The FileSystemWatcher usually detects it faster, but this poll is a
   * safety net for platforms where FS events are unreliable.
   */
  LAUNCH_DISCOVERY_POLL_MS: 500,
  /** Maximum number of poll attempts before giving up (500ms * 20 = 10s). */
  LAUNCH_DISCOVERY_MAX_RETRIES: 20,
  /**
   * Settle time (ms) after closing an external terminal before resuming a session.
   * Allows the Claude process to fully exit and flush JSONL writes. 1.5s is
   * generous enough for graceful shutdown on slow machines.
   */
  TRANSFER_SETTLE_MS: 1_500,
  /** Maximum ancestor depth when walking the process tree to find a VS Code terminal. */
  PROCESS_TREE_MAX_DEPTH: 10,
} as const;

/** Well-known record and tool names used for special-case handling. */
export const SPECIAL_NAMES = {
  ASK_USER_QUESTION: 'AskUserQuestion',
  EXIT_PLAN_MODE: 'ExitPlanMode',
  ENTER_PLAN_MODE: 'EnterPlanMode',
  TURN_DURATION_SUBTYPE: 'turn_duration',
  STOP_HOOK_SUMMARY_SUBTYPE: 'stop_hook_summary',
  END_TURN_STOP_REASON: 'end_turn',
  WRITE_TOOL: 'Write',
  TASK_TOOL: 'Task',
  /** stop_reason value indicating model finished and tools await permission/execution. */
  TOOL_USE_STOP_REASON: 'tool_use',
} as const;

/** Environment variables set by Claude Code when it launches a child process. */
export const CLAUDE_ENV = {
  /** Set to '1' when running inside a Claude Code session. */
  ACTIVE: 'CLAUDECODE',
  /** SSE port for reverse IPC. */
  SSE_PORT: 'CLAUDE_CODE_SSE_PORT',
  /** Entry point type (e.g., 'cli'). */
  ENTRYPOINT: 'CLAUDE_CODE_ENTRYPOINT',
} as const;

/** Error messages for user-facing feedback. */
export const ERROR_MESSAGES = {
  /** Shown when user tries to launch/adopt inside a nested Claude session. */
  NESTED_SESSION:
    'Cannot launch sessions from inside Claude Code. Use the terminal running Claude directly.',
} as const;

/** Heuristics for identifying system-generated artifact sessions. */
export const ARTIFACT_DETECTION = {
  /** Prefix on autoName that identifies episodic-memory plugin sessions. */
  EPISODIC_MEMORY_PREFIX: 'Context: ',
  /** Substring in autoName that identifies local-command-caveat system messages. */
  LOCAL_COMMAND_CAVEAT: 'local-command-caveat',
} as const;

/** Auto-reconnect configuration for resuming terminals on startup. */
export const AUTO_RECONNECT = {
  /** Fallback timeout (ms) if SessionTracker never fires onStateChanged. */
  FALLBACK_TIMEOUT_MS: 10_000,
  /** Max terminals opened automatically to avoid flooding. */
  MAX_SESSIONS: 5,
  /** Prune persisted entries older than this (days). */
  TTL_DAYS: 7,
} as const;

/** CLI argument strings for Claude Code session launch modes. */
export const CLAUDE_CLI = {
  /** Flag to skip all permission prompts (use with caution). */
  DANGEROUSLY_SKIP_PERMISSIONS: '--dangerously-skip-permissions',
  /** Subcommand to start a remote control session. */
  REMOTE_CONTROL: 'remote-control',
} as const;

/** Hook event names from Claude Code hooks API. */
export const HOOK_EVENTS = {
  SESSION_START: 'SessionStart',
  USER_PROMPT_SUBMIT: 'UserPromptSubmit',
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  POST_TOOL_USE_FAILURE: 'PostToolUseFailure',
  PERMISSION_REQUEST: 'PermissionRequest',
  NOTIFICATION: 'Notification',
  SUBAGENT_START: 'SubagentStart',
  STOP: 'Stop',
  SESSION_END: 'SessionEnd',
  PRE_COMPACT: 'PreCompact',
} as const;

/** Notification subtypes from the Notification hook event. */
export const HOOK_NOTIFICATION_TYPES = {
  IDLE_PROMPT: 'idle_prompt',
  PERMISSION_PROMPT: 'permission_prompt',
} as const;

/** Directory for hook event files written by conductor-hook.sh. */
export const HOOK_EVENTS_DIR = '~/.conductor/events';

/** Staleness threshold (ms): if no hook event for this long, fall back to JSONL. */
export const HOOK_STALENESS_MS = 60_000;

/** Max buffered hook events per session for sessions not yet discovered via JSONL. */
export const HOOK_BUFFER_MAX_EVENTS = 50;

/** TTL (ms) for pending hook event buffers (discard if session never appears). */
export const HOOK_BUFFER_TTL_MS = 60_000;

/** User-visible strings for the Quick Pick session switcher. */
export const QUICK_PICK_STRINGS = {
  /** Placeholder text shown in the Quick Pick input. */
  PLACEHOLDER: 'Switch to session...',
  /** Shown when no sessions are available. */
  NO_SESSIONS: 'No active sessions found',
} as const;

/** Usage tab configuration. */
export const USAGE = {
  /** Number of recent days shown in the daily trend chart. */
  DAILY_TREND_DAYS: 7,
  /** Expected stats-cache.json version. */
  SUPPORTED_CACHE_VERSION: 1,
} as const;

// Re-export shared constants so extension code has a single import point.
export {
  CONTENT_BLOCK_TYPES,
  RECORD_TYPES,
  SESSION_STATUSES,
  ACTIVITY_TYPES,
  CONVERSATION_ROLES,
  SYSTEM_EVENTS,
  STATUS_GROUPS,
  TOOL_APPROVAL_INPUTS,
  PLAN_INPUTS,
  LAUNCH_MODES,
  NAV_DIRECTIONS,
} from './models/sharedConstants';
export type { LaunchMode, NavDirection } from './models/sharedConstants';
