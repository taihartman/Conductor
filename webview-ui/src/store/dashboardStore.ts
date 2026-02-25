import { create } from 'zustand';

export type SessionStatus = 'active' | 'idle' | 'waiting';

export interface SessionInfo {
  sessionId: string;
  slug: string;
  summary: string;
  status: SessionStatus;
  model: string;
  gitBranch: string;
  cwd: string;
  startedAt: string;
  lastActivityAt: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  isSubAgent: boolean;
  parentSessionId?: string;
  filePath: string;
}

export interface ActivityEvent {
  id: string;
  sessionId: string;
  sessionSlug: string;
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'text' | 'turn_end' | 'user_input';
  toolName?: string;
  toolInput?: string;
  text?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface ToolStatEntry {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface TokenSummary {
  sessionId: string;
  sessionSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number;
}

export type FilterMode = 'recent' | 'active' | 'all';

interface DashboardState {
  sessions: SessionInfo[];
  activities: ActivityEvent[];
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
  focusedSessionId: string | null;
  filterMode: FilterMode;

  setSessions: (sessions: SessionInfo[]) => void;
  setActivities: (activities: ActivityEvent[]) => void;
  setToolStats: (stats: ToolStatEntry[]) => void;
  setTokenSummaries: (summaries: TokenSummary[]) => void;
  setFocusedSession: (sessionId: string | null) => void;
  setFilterMode: (mode: FilterMode) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  sessions: [],
  activities: [],
  toolStats: [],
  tokenSummaries: [],
  focusedSessionId: null,
  filterMode: 'recent',

  setSessions: (sessions) => set({ sessions }),
  setActivities: (activities) => set({ activities }),
  setToolStats: (stats) => set({ toolStats: stats }),
  setTokenSummaries: (summaries) => set({ tokenSummaries: summaries }),
  setFocusedSession: (sessionId) => set({ focusedSessionId: sessionId }),
  setFilterMode: (mode) => set({ filterMode: mode }),
}));
