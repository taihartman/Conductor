export const COLORS = {
  ERROR_ROW_BG: 'rgba(220, 53, 69, 0.1)',
  TOOL_BADGE_BG: 'rgba(0, 122, 204, 0.15)',
  SELECTED_CARD_BG: 'rgba(0, 122, 204, 0.1)',
  HOVER_CARD_BG: 'rgba(255, 255, 255, 0.04)',
  ERROR_BAR: 'rgba(220, 53, 69, 0.6)',
  NORMAL_BAR: 'rgba(0, 122, 204, 0.5)',
  HIGH_COST_WARNING: '#f0ad4e',
  ZEN_NOTE_BRIGHT: 'rgba(220, 200, 255, 0.8)',
  TOOL_BLOCK_BORDER: 'var(--vscode-panel-border, rgba(255, 255, 255, 0.1))',
  TOOL_BLOCK_HEADER_HOVER: 'rgba(255, 255, 255, 0.05)',
  TOOL_BLOCK_ERROR_INDICATOR: '#c74e39',
  TOOL_BLOCK_SUCCESS_INDICATOR: '#74c991',
  TOOL_BLOCK_PENDING_INDICATOR: '#e1c08d',
  SYSTEM_TURN_BORDER: 'rgba(255, 255, 255, 0.08)',
  SUB_AGENT_BG: 'rgba(0, 122, 204, 0.08)',
  SUB_AGENT_BORDER: 'rgba(0, 122, 204, 0.2)',
  ANALYTICS_DRAWER_BG: 'var(--bg-secondary)',
  CODE_BLOCK_BG: 'rgba(0, 0, 0, 0.25)',
  INLINE_CODE_BG: 'rgba(0, 0, 0, 0.2)',
  DRAG_HANDLE_HOVER: 'rgba(255, 255, 255, 0.5)',
  DRAG_INDICATOR: 'rgba(0, 122, 204, 0.8)',
  DRAG_INDICATOR_GLOW: 'rgba(0, 122, 204, 0.3)',
  DRAG_GHOST_BG: 'rgba(30, 30, 30, 0.85)',
  CHAT_INPUT_BG: 'var(--vscode-input-background, rgba(0, 0, 0, 0.15))',
  CHAT_INPUT_BORDER: 'var(--vscode-inlineChatInput-border, rgba(255, 255, 255, 0.1))',
  QUESTION_OPTION_BG: 'rgba(255, 255, 255, 0.04)',
  QUESTION_OPTION_HOVER_BG: 'rgba(255, 255, 255, 0.08)',
  QUESTION_OPTION_BORDER: 'rgba(255, 255, 255, 0.1)',
  QUESTION_OPTION_BADGE_BG: 'rgba(255, 255, 255, 0.1)',
  CONTINUATION_BADGE_BG: 'rgba(255, 255, 255, 0.08)',
  /** YOLO (bypass permissions) badge background — amber tint matching split button highlight */
  YOLO_BADGE_BG: 'rgba(240, 173, 78, 0.2)',
  CONTINUATION_DIVIDER_BORDER: 'rgba(255, 193, 7, 0.3)',
  CONTINUATION_DIVIDER_TEXT: 'rgba(255, 193, 7, 0.7)',
  CONTEXT_MENU_BG: 'var(--bg-card)',
  CONTEXT_MENU_BORDER: 'var(--border)',
  CONTEXT_MENU_HOVER_BG: 'rgba(255, 255, 255, 0.08)',
  CONTEXT_MENU_SHADOW: 'rgba(0, 0, 0, 0.3)',
  TOOL_DENY_BUTTON_BG: 'rgba(220, 53, 69, 0.15)',
  TOOL_ALLOW_ALWAYS_BUTTON_BG: 'rgba(255, 255, 255, 0.08)',
  /** User turn input-box background */
  USER_TURN_BG: 'var(--vscode-input-background, rgba(255, 255, 255, 0.04))',
  /** User turn input-box border */
  USER_TURN_BORDER: 'var(--vscode-inlineChatInput-border, rgba(255, 255, 255, 0.12))',
  /** Send button background (Claude clay) */
  SEND_BUTTON_BG: '#c6613f',
  /** Send button when disabled */
  SEND_BUTTON_DISABLED_BG: 'rgba(255, 255, 255, 0.05)',
  /** Send button text color (Claude ivory) */
  SEND_BUTTON_COLOR: '#faf9f5',
  /** Primary action buttons — Allow, Approve, Yes (Claude clay) */
  PRIMARY_ACTION_BG: '#c6613f',
  /** Primary action button text color (Claude ivory) */
  PRIMARY_ACTION_COLOR: '#faf9f5',
} as const;

/** Terminal-specific configuration for xterm.js Canvas 2D renderer. */
export const TERMINAL_CONFIG = {
  /** Fallback monospace font stack when CSS variable is unavailable. */
  FONT_FALLBACK: '"Fira Code", monospace',
  /** Terminal font size in pixels. */
  FONT_SIZE: 13,
} as const;

export const SIZES = {
  CODE_BLOCK_MAX_HEIGHT: '400px',
  TOOL_INPUT_MAX_HEIGHT: '200px',
  TOOL_OUTPUT_MAX_HEIGHT: '300px',
  /** Status indicator dot diameter */
  TOOL_STATUS_DOT: '7px',
} as const;
