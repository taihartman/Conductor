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
} as const;

/** Path segments used to locate Claude transcript files on disk. */
export const FS_PATHS = {
  CLAUDE_DIR: '.claude',
  PROJECTS_DIR: 'projects',
  SUBAGENTS_DIR: 'subagents',
  PLANS_DIR: 'plans',
  JSONL_EXT: '.jsonl',
  AGENT_PREFIX: 'agent-',
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

/** Heuristics for identifying system-generated artifact sessions. */
export const ARTIFACT_DETECTION = {
  /** Prefix on autoName that identifies episodic-memory plugin sessions. */
  EPISODIC_MEMORY_PREFIX: 'Context: ',
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
} from './models/sharedConstants';
