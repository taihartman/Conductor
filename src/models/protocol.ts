import {
  SessionInfo,
  ActivityEvent,
  ToolStatEntry,
  TokenSummary,
} from './types';

// Extension -> Webview messages
export type ExtensionToWebviewMessage =
  | { type: 'sessions:update'; sessions: SessionInfo[] }
  | { type: 'activity:full'; events: ActivityEvent[] }
  | { type: 'toolStats:update'; stats: ToolStatEntry[] }
  | { type: 'tokens:update'; tokenSummaries: TokenSummary[] }
  | { type: 'config:theme'; theme: 'dark' | 'light' };

// Webview -> Extension messages
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'session:focus'; sessionId: string }
  | { type: 'refresh' };
