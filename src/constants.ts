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
} as const;

/** Structured log prefixes for Debug Console output. */
export const LOG_PREFIX = {
  EXTENSION: '[Conductor]',
  PANEL: '[Conductor:Panel]',
  SESSION_TRACKER: '[Conductor:SessionTracker]',
  WATCHER: '[Conductor:Watcher]',
  SCANNER: '[Conductor:Scanner]',
} as const;

/** Path segments used to locate Claude transcript files on disk. */
export const FS_PATHS = {
  CLAUDE_DIR: '.claude',
  PROJECTS_DIR: 'projects',
  SUBAGENTS_DIR: 'subagents',
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
} as const;

/** Well-known record and tool names used for special-case handling. */
export const SPECIAL_NAMES = {
  ASK_USER_QUESTION: 'AskUserQuestion',
  TURN_DURATION_SUBTYPE: 'turn_duration',
  END_TURN_STOP_REASON: 'end_turn',
} as const;
