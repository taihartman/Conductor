// Extension identity
export const OUTPUT_CHANNEL_NAME = 'Conductor';
export const STATUS_BAR_TEXT = '$(pulse) Conductor';
export const STATUS_BAR_TOOLTIP = 'Open Conductor';
export const PANEL_TITLE = 'Conductor';

// Command IDs (must match package.json)
export const COMMANDS = {
  OPEN: 'conductor.open',
  REFRESH: 'conductor.refresh',
} as const;

// Log prefixes
export const LOG_PREFIX = {
  EXTENSION: '[Conductor]',
  PANEL: '[Conductor:Panel]',
  SESSION_TRACKER: '[Conductor:SessionTracker]',
  WATCHER: '[Conductor:Watcher]',
  SCANNER: '[Conductor:Scanner]',
} as const;

// File system path segments
export const FS_PATHS = {
  CLAUDE_DIR: '.claude',
  PROJECTS_DIR: 'projects',
  SUBAGENTS_DIR: 'subagents',
  JSONL_EXT: '.jsonl',
  AGENT_PREFIX: 'agent-',
} as const;

// Text truncation limits
export const TRUNCATION = {
  TEXT_MAX: 200,
  DESCRIPTION_MAX: 100,
  BASH_COMMAND_MAX: 100,
  URL_MAX: 80,
  ERROR_MESSAGE_MAX: 200,
} as const;

// Special record/tool names
export const SPECIAL_NAMES = {
  ASK_USER_QUESTION: 'AskUserQuestion',
  TURN_DURATION_SUBTYPE: 'turn_duration',
  END_TURN_STOP_REASON: 'end_turn',
} as const;
