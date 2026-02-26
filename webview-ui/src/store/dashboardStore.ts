import { create } from 'zustand';
import type { Layout } from 'react-resizable-panels';
import type {
  SessionInfo,
  ActivityEvent,
  ConversationTurn,
  ToolStatEntry,
  TokenSummary,
} from '@shared/types';
import type { InputSendStatus } from '@shared/protocol';
import type { LaunchMode } from '@shared/sharedConstants';
import { LAUNCH_MODES } from '@shared/sharedConstants';

export type FilterMode = 'recent' | 'active' | 'all';

/** Max PTY buffer size per session (matches PTY.RING_BUFFER_SIZE in extension constants). */
const PTY_BUFFER_MAX = 102400;

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

/** Overview panel display mode discriminators. */
export const OVERVIEW_MODES = {
  LIST: 'list',
  BOARD: 'board',
} as const;

export type OverviewMode = (typeof OVERVIEW_MODES)[keyof typeof OVERVIEW_MODES];

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
  /** Persisted resizable panel layout across session focus/unfocus cycles. */
  panelLayout: Layout | null;
  /** Per-session view mode for Conductor-launched sessions. */
  viewModes: Map<string, 'conversation' | 'terminal'>;
  /** Per-session PTY ring buffer replay data (populated on session:launch-status). */
  ptyBuffers: Map<string, string>;
  /** Active tab in the overview panel. */
  activeTab: 'sessions' | 'hidden';
  /** Session ID from a Conductor-initiated launch, awaiting appearance in state:full. */
  pendingLaunchSessionId: string | null;
  /** Session IDs currently being adopted for terminal mode. */
  pendingAdoptions: Set<string>;
  /** True when the extension host is running inside a Claude Code session. */
  isNestedSession: boolean;
  /** Whether the settings drawer is open. */
  settingsDrawerOpen: boolean;
  /** User-defined auto-hide patterns from VS Code settings. */
  autoHidePatterns: string[];
  /** Last-used launch mode for the split button (synced from extension workspace state). */
  launchMode: LaunchMode;
  /** Overview panel display mode: list or board (kanban). */
  overviewMode: OverviewMode;

  setPendingLaunchSession: (sessionId: string | null) => void;
  addPendingAdoption: (sessionId: string) => void;
  removePendingAdoption: (sessionId: string) => void;
  setFullState: (
    sessions: SessionInfo[],
    activities: ActivityEvent[],
    conversation: ConversationTurn[],
    toolStats: ToolStatEntry[],
    tokenSummaries: TokenSummary[],
    isNestedSession: boolean
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
  setPanelLayout: (layout: Layout) => void;
  setViewMode: (sessionId: string, mode: 'conversation' | 'terminal') => void;
  toggleViewMode: (sessionId: string) => void;
  appendPtyBuffer: (sessionId: string, data: string) => void;
  /** Bulk-replace PTY buffers (replay on webview reconnect). Size-capped per session. */
  setPtyBuffers: (buffers: Record<string, string>) => void;
  setActiveTab: (tab: 'sessions' | 'hidden') => void;
  toggleSettingsDrawer: () => void;
  setAutoHidePatterns: (patterns: string[]) => void;
  setLaunchMode: (mode: LaunchMode) => void;
  setOverviewMode: (mode: OverviewMode) => void;
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
  panelLayout: null,
  viewModes: new Map(),
  ptyBuffers: new Map(),
  activeTab: 'sessions',
  pendingLaunchSessionId: null,
  pendingAdoptions: new Set(),
  isNestedSession: false,
  settingsDrawerOpen: false,
  autoHidePatterns: [],
  launchMode: LAUNCH_MODES.NORMAL,
  overviewMode: OVERVIEW_MODES.LIST,

  setPendingLaunchSession: (sessionId) => set({ pendingLaunchSessionId: sessionId }),
  addPendingAdoption: (sessionId) =>
    set((state) => {
      const next = new Set(state.pendingAdoptions);
      next.add(sessionId);
      return { pendingAdoptions: next };
    }),
  removePendingAdoption: (sessionId) =>
    set((state) => {
      const next = new Set(state.pendingAdoptions);
      next.delete(sessionId);
      return { pendingAdoptions: next };
    }),
  setFullState: (sessions, activities, conversation, toolStats, tokenSummaries, isNestedSession) =>
    set((state) => {
      const pending = state.pendingLaunchSessionId;
      const found = pending !== null && sessions.some((s) => s.sessionId === pending);
      return {
        sessions,
        activities,
        conversation,
        toolStats,
        tokenSummaries,
        isNestedSession,
        ...(found
          ? {
              focusedSessionId: pending,
              detailViewMode: DETAIL_VIEW_MODES.SPLIT,
              filteredSubAgentId: null,
              pendingLaunchSessionId: null,
            }
          : {}),
      };
    }),
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
  setPanelLayout: (layout) => set({ panelLayout: layout }),
  setViewMode: (sessionId, mode) =>
    set((state) => {
      const next = new Map(state.viewModes);
      next.set(sessionId, mode);
      return { viewModes: next };
    }),
  toggleViewMode: (sessionId) =>
    set((state) => {
      const next = new Map(state.viewModes);
      const current = next.get(sessionId) ?? 'terminal';
      next.set(sessionId, current === 'conversation' ? 'terminal' : 'conversation');
      return { viewModes: next };
    }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  appendPtyBuffer: (sessionId, data) =>
    set((state) => {
      const next = new Map(state.ptyBuffers);
      const existing = next.get(sessionId) ?? '';
      next.set(sessionId, existing + data);
      return { ptyBuffers: next };
    }),
  setPtyBuffers: (buffers) =>
    set((state) => {
      const next = new Map(state.ptyBuffers);
      for (const [sessionId, data] of Object.entries(buffers)) {
        // Replace, don't append — this is bulk replay
        next.set(sessionId, data.length > PTY_BUFFER_MAX ? data.slice(-PTY_BUFFER_MAX) : data);
      }
      return { ptyBuffers: next };
    }),
  toggleSettingsDrawer: () => set((state) => ({ settingsDrawerOpen: !state.settingsDrawerOpen })),
  setAutoHidePatterns: (patterns) => set({ autoHidePatterns: patterns }),
  setLaunchMode: (mode) => set({ launchMode: mode }),
  setOverviewMode: (mode) => set({ overviewMode: mode }),
  zenModeActive: false,
  zenExitedAt: null,
  enterZenMode: () =>
    set((state) => ({
      zenModeActive: state.sessions.length > 0,
      zenExitedAt: null,
    })),
  exitZenMode: () => set({ zenModeActive: false, zenExitedAt: Date.now() }),
}));
