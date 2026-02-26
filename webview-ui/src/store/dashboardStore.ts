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

/** Detail view mode discriminators for the dashboard layout. */
export const DETAIL_VIEW_MODES = {
  OVERVIEW_ONLY: 'overview-only',
  SPLIT: 'split',
  EXPANDED: 'expanded',
} as const;

export type DetailViewMode = (typeof DETAIL_VIEW_MODES)[keyof typeof DETAIL_VIEW_MODES];

/** Layout orientation discriminators for the resizable panel group. */
export const LAYOUT_ORIENTATIONS = {
  VERTICAL: 'vertical',
  HORIZONTAL: 'horizontal',
} as const;

export type LayoutOrientation = (typeof LAYOUT_ORIENTATIONS)[keyof typeof LAYOUT_ORIENTATIONS];

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
  /** Per-session view mode for Conductor-launched sessions. */
  viewModes: Map<string, 'conversation' | 'terminal'>;
  /** Per-session PTY ring buffer replay data (populated on session:launch-status). */
  ptyBuffers: Map<string, string>;

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
  setViewMode: (sessionId: string, mode: 'conversation' | 'terminal') => void;
  toggleViewMode: (sessionId: string) => void;
  appendPtyBuffer: (sessionId: string, data: string) => void;
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
  detailViewMode: DETAIL_VIEW_MODES.OVERVIEW_ONLY,
  filteredSubAgentId: null,
  analyticsDrawerOpen: false,
  searchQuery: '',
  layoutOrientation: LAYOUT_ORIENTATIONS.HORIZONTAL,
  lastInputStatus: null,
  viewModes: new Map(),
  ptyBuffers: new Map(),

  setFullState: (sessions, activities, conversation, toolStats, tokenSummaries) =>
    set({ sessions, activities, conversation, toolStats, tokenSummaries }),
  setActivities: (activities) => set({ activities }),
  setConversation: (turns) => set({ conversation: turns }),
  setFocusedSession: (sessionId) =>
    set({
      focusedSessionId: sessionId,
      detailViewMode: sessionId ? DETAIL_VIEW_MODES.SPLIT : DETAIL_VIEW_MODES.OVERVIEW_ONLY,
      filteredSubAgentId: null,
    }),
  setFilterMode: (mode) => set({ filterMode: mode }),
  setDetailViewMode: (mode) => set({ detailViewMode: mode }),
  setFilteredSubAgentId: (id) =>
    set((state) => ({
      filteredSubAgentId: state.filteredSubAgentId === id ? null : id,
    })),
  expandFocusedSession: () => set({ detailViewMode: DETAIL_VIEW_MODES.EXPANDED }),
  collapseFocusedSession: () =>
    set((state) => ({
      detailViewMode:
        state.detailViewMode === DETAIL_VIEW_MODES.EXPANDED
          ? DETAIL_VIEW_MODES.SPLIT
          : DETAIL_VIEW_MODES.OVERVIEW_ONLY,
      focusedSessionId:
        state.detailViewMode === DETAIL_VIEW_MODES.SPLIT ? null : state.focusedSessionId,
      filteredSubAgentId:
        state.detailViewMode === DETAIL_VIEW_MODES.SPLIT ? null : state.filteredSubAgentId,
    })),
  clearFocus: () =>
    set({
      focusedSessionId: null,
      detailViewMode: DETAIL_VIEW_MODES.OVERVIEW_ONLY,
      filteredSubAgentId: null,
    }),
  toggleAnalyticsDrawer: () =>
    set((state) => ({ analyticsDrawerOpen: !state.analyticsDrawerOpen })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleLayoutOrientation: () =>
    set((state) => ({
      layoutOrientation:
        state.layoutOrientation === LAYOUT_ORIENTATIONS.VERTICAL
          ? LAYOUT_ORIENTATIONS.HORIZONTAL
          : LAYOUT_ORIENTATIONS.VERTICAL,
    })),
  setInputStatus: (status) => set({ lastInputStatus: status }),
  setViewMode: (sessionId, mode) =>
    set((state) => {
      const next = new Map(state.viewModes);
      next.set(sessionId, mode);
      return { viewModes: next };
    }),
  toggleViewMode: (sessionId) =>
    set((state) => {
      const next = new Map(state.viewModes);
      const current = next.get(sessionId) ?? 'conversation';
      next.set(sessionId, current === 'conversation' ? 'terminal' : 'conversation');
      return { viewModes: next };
    }),
  appendPtyBuffer: (sessionId, data) =>
    set((state) => {
      const next = new Map(state.ptyBuffers);
      const existing = next.get(sessionId) ?? '';
      next.set(sessionId, existing + data);
      return { ptyBuffers: next };
    }),
  zenModeActive: false,
  zenExitedAt: null,
  enterZenMode: () =>
    set((state) => ({
      zenModeActive: state.sessions.length > 0,
      zenExitedAt: null,
    })),
  exitZenMode: () => set({ zenModeActive: false, zenExitedAt: Date.now() }),
}));
