import { create } from 'zustand';
import type {
  SessionInfo,
  ActivityEvent,
  ConversationTurn,
  ToolStatEntry,
  TokenSummary,
} from '@shared/types';
import type { InputSendStatus } from '@shared/protocol';

export type FilterMode = 'recent' | 'active' | 'all';
export type DetailViewMode = 'overview-only' | 'split' | 'expanded';
export type LayoutOrientation = 'vertical' | 'horizontal';

interface DashboardState {
  sessions: SessionInfo[];
  activities: ActivityEvent[];
  conversation: ConversationTurn[];
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
  focusedSessionId: string | null;
  filterMode: FilterMode;
  detailViewMode: DetailViewMode;
  filteredSubAgentId: string | null;
  analyticsDrawerOpen: boolean;
  searchQuery: string;
  layoutOrientation: LayoutOrientation;
  lastInputStatus: { sessionId: string; status: InputSendStatus; error?: string } | null;

  setFullState: (
    sessions: SessionInfo[],
    activities: ActivityEvent[],
    conversation: ConversationTurn[],
    toolStats: ToolStatEntry[],
    tokenSummaries: TokenSummary[]
  ) => void;
  setActivities: (activities: ActivityEvent[]) => void;
  setConversation: (turns: ConversationTurn[]) => void;
  setFocusedSession: (sessionId: string | null) => void;
  setFilterMode: (mode: FilterMode) => void;
  setDetailViewMode: (mode: DetailViewMode) => void;
  setFilteredSubAgentId: (id: string | null) => void;
  expandFocusedSession: () => void;
  collapseFocusedSession: () => void;
  clearFocus: () => void;
  toggleAnalyticsDrawer: () => void;
  setSearchQuery: (query: string) => void;
  toggleLayoutOrientation: () => void;
  setInputStatus: (status: { sessionId: string; status: InputSendStatus; error?: string }) => void;
  zenModeActive: boolean;
  zenExitedAt: number | null;
  enterZenMode: () => void;
  exitZenMode: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  sessions: [],
  activities: [],
  conversation: [],
  toolStats: [],
  tokenSummaries: [],
  focusedSessionId: null,
  filterMode: 'recent',
  detailViewMode: 'overview-only',
  filteredSubAgentId: null,
  analyticsDrawerOpen: false,
  searchQuery: '',
  layoutOrientation: 'vertical',
  lastInputStatus: null,

  setFullState: (sessions, activities, conversation, toolStats, tokenSummaries) =>
    set({ sessions, activities, conversation, toolStats, tokenSummaries }),
  setActivities: (activities) => set({ activities }),
  setConversation: (turns) => set({ conversation: turns }),
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
  toggleAnalyticsDrawer: () =>
    set((state) => ({ analyticsDrawerOpen: !state.analyticsDrawerOpen })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleLayoutOrientation: () =>
    set((state) => ({
      layoutOrientation: state.layoutOrientation === 'vertical' ? 'horizontal' : 'vertical',
    })),
  setInputStatus: (status) => set({ lastInputStatus: status }),
  zenModeActive: false,
  zenExitedAt: null,
  enterZenMode: () =>
    set((state) => ({
      zenModeActive: state.sessions.length > 0,
      zenExitedAt: null,
    })),
  exitZenMode: () => set({ zenModeActive: false, zenExitedAt: Date.now() }),
}));
