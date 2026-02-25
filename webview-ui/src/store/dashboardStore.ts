import { create } from 'zustand';
import type {
  SessionInfo,
  SubAgentInfo,
  SessionStatus,
  ActivityEvent,
  ToolStatEntry,
  TokenSummary,
} from '@shared/types';

export type {
  SessionInfo,
  SubAgentInfo,
  SessionStatus,
  ActivityEvent,
  ToolStatEntry,
  TokenSummary,
};

export type FilterMode = 'recent' | 'active' | 'all';
export type DetailViewMode = 'overview-only' | 'split' | 'expanded';

interface DashboardState {
  sessions: SessionInfo[];
  activities: ActivityEvent[];
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
  focusedSessionId: string | null;
  filterMode: FilterMode;
  detailViewMode: DetailViewMode;
  filteredSubAgentId: string | null;

  setSessions: (sessions: SessionInfo[]) => void;
  setActivities: (activities: ActivityEvent[]) => void;
  setToolStats: (stats: ToolStatEntry[]) => void;
  setTokenSummaries: (summaries: TokenSummary[]) => void;
  setFocusedSession: (sessionId: string | null) => void;
  setFilterMode: (mode: FilterMode) => void;
  setDetailViewMode: (mode: DetailViewMode) => void;
  setFilteredSubAgentId: (id: string | null) => void;
  expandFocusedSession: () => void;
  collapseFocusedSession: () => void;
  clearFocus: () => void;
  zenModeActive: boolean;
  enterZenMode: () => void;
  exitZenMode: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  sessions: [],
  activities: [],
  toolStats: [],
  tokenSummaries: [],
  focusedSessionId: null,
  filterMode: 'recent',
  detailViewMode: 'overview-only',
  filteredSubAgentId: null,

  setSessions: (sessions) => set({ sessions }),
  setActivities: (activities) => set({ activities }),
  setToolStats: (stats) => set({ toolStats: stats }),
  setTokenSummaries: (summaries) => set({ tokenSummaries: summaries }),
  setFocusedSession: (sessionId) =>
    set({
      focusedSessionId: sessionId,
      detailViewMode: sessionId ? 'split' : 'overview-only',
      filteredSubAgentId: null,
    }),
  setFilterMode: (mode) => set({ filterMode: mode }),
  setDetailViewMode: (mode) => set({ detailViewMode: mode }),
  setFilteredSubAgentId: (id) =>
    set((state) => ({
      filteredSubAgentId: state.filteredSubAgentId === id ? null : id,
    })),
  expandFocusedSession: () => set({ detailViewMode: 'expanded' }),
  collapseFocusedSession: () =>
    set((state) => ({
      detailViewMode: state.detailViewMode === 'expanded' ? 'split' : 'overview-only',
      focusedSessionId: state.detailViewMode === 'split' ? null : state.focusedSessionId,
      filteredSubAgentId: state.detailViewMode === 'split' ? null : state.filteredSubAgentId,
    })),
  clearFocus: () =>
    set({
      focusedSessionId: null,
      detailViewMode: 'overview-only',
      filteredSubAgentId: null,
    }),
  zenModeActive: false,
  enterZenMode: () =>
    set((state) => ({
      zenModeActive: state.sessions.length > 0,
    })),
  exitZenMode: () => set({ zenModeActive: false }),
}));
