import { create } from 'zustand';
import { DEFAULT_MONITORING_SCOPE } from '../config/strings';
import type { Layout } from 'react-resizable-panels';
import type {
  SessionInfo,
  ActivityEvent,
  ConversationTurn,
  ToolStatEntry,
  TokenSummary,
  HistoryEntry,
  StatsCache,
  TileNode,
  SavedTileLayout,
} from '@shared/types';
import type { InputSendStatus } from '@shared/protocol';
import type { LaunchMode, OverviewMode, SortDirection } from '@shared/sharedConstants';
import { LAUNCH_MODES, OVERVIEW_MODES, SORT_DIRECTIONS } from '@shared/sharedConstants';
import {
  generateTileId,
  splitNode,
  removeNode,
  updateSizes,
  setLeafSession,
  findLeafBySessionId,
} from '../utils/tileTree';

export type FilterMode = 'recent' | 'active' | 'all';

/** Max PTY buffer size per session (matches PTY.RING_BUFFER_SIZE in extension constants). */
const PTY_BUFFER_MAX = 102400;

/** Detail view mode discriminators for the dashboard layout. */
export const DETAIL_VIEW_MODES = {
  OVERVIEW_ONLY: 'overview-only',
  SPLIT: 'split',
  EXPANDED: 'expanded',
  TILING: 'tiling',
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
  /** Persisted resizable panel layout across session focus/unfocus cycles. */
  panelLayout: Layout | null;
  /** Per-session view mode for Conductor-launched sessions. */
  viewModes: Map<string, 'conversation' | 'terminal'>;
  /** Per-session PTY ring buffer replay data (populated on session:launch-status). */
  ptyBuffers: Map<string, string>;
  /** Active tab in the overview panel. */
  activeTab: 'sessions' | 'hidden' | 'history' | 'usage';
  /** Session history entries for the History tab (populated on demand). */
  historyEntries: HistoryEntry[];
  /** Usage stats from ~/.claude/stats-cache.json (populated on demand). */
  usageData: StatsCache | null;
  /** Session ID from a Conductor-initiated launch, awaiting appearance in state:full. */
  pendingLaunchSessionId: string | null;
  /** Session IDs currently being adopted for terminal mode. */
  pendingAdoptions: Set<string>;
  /** True when the extension host is running inside a Claude Code session. */
  isNestedSession: boolean;
  /** Human-readable description of which directories are monitored for sessions. */
  monitoringScope: string;
  /** Whether the settings drawer is open. */
  settingsDrawerOpen: boolean;
  /** User-defined auto-hide patterns from VS Code settings. */
  autoHidePatterns: string[];
  /** Last-used launch mode for the split button (synced from extension workspace state). */
  launchMode: LaunchMode;
  /** Overview panel display mode: list or board (kanban). */
  overviewMode: OverviewMode;
  /** Session ID highlighted by keyboard navigation (distinct from focusedSessionId). */
  keyboardFocusedSessionId: string | null;
  /** Spatial anchor (x, y) for directional navigation. */
  navAnchor: { x: number; y: number } | null;
  /** Per-column sort direction for the Kanban board (missing keys default to 'desc'). */
  kanbanSortOrders: Record<string, SortDirection>;

  // ---- Tiling workspace state ----

  /** Root of the tile tree (null when not in tiling mode). */
  tileRoot: TileNode | null;
  /** ID of the active (focused) tile leaf. */
  activeTileId: string | null;
  /** Saved tile layout presets from the extension. */
  savedTileLayouts: SavedTileLayout[];
  /** Per-session activity data for tiled panels. */
  activitiesBySession: Map<string, ActivityEvent[]>;
  /** Per-session conversation data for tiled panels. */
  conversationBySession: Map<string, ConversationTurn[]>;
  /** Current drop target during a drag-to-tile operation (for visual feedback). */
  dragToTileTarget: { tileId: string; edge: string } | null;

  setPendingLaunchSession: (sessionId: string | null) => void;
  addPendingAdoption: (sessionId: string) => void;
  removePendingAdoption: (sessionId: string) => void;
  setFullState: (
    sessions: SessionInfo[],
    activities: ActivityEvent[],
    conversation: ConversationTurn[],
    toolStats: ToolStatEntry[],
    tokenSummaries: TokenSummary[],
    isNestedSession: boolean,
    focusedSessionId: string | null,
    monitoringScope?: string
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
  appendPtyBuffer: (sessionId: string, data: string) => void;
  /** Bulk-replace PTY buffers (replay on webview reconnect). Size-capped per session. */
  setPtyBuffers: (buffers: Record<string, string>) => void;
  setActiveTab: (tab: 'sessions' | 'hidden' | 'history' | 'usage') => void;
  setHistoryEntries: (entries: HistoryEntry[]) => void;
  setUsageData: (data: StatsCache | null) => void;
  toggleSettingsDrawer: () => void;
  setAutoHidePatterns: (patterns: string[]) => void;
  setLaunchMode: (mode: LaunchMode) => void;
  setOverviewMode: (mode: OverviewMode) => void;
  toggleKanbanSortOrder: (columnKey: string) => void;
  setKanbanSortOrders: (sortOrders: Record<string, SortDirection>) => void;
  setKeyboardFocus: (sessionId: string | null, anchor?: { x: number; y: number }) => void;
  clearKeyboardFocus: () => void;
  zenModeActive: boolean;
  zenExitedAt: number | null;
  enterZenMode: () => void;
  exitZenMode: () => void;

  // ---- Tiling actions ----

  /** Enter tiling mode with an initial leaf for the given session. */
  enterTilingMode: (sessionId: string) => void;
  /** Exit tiling mode and return to overview-only. */
  exitTilingMode: () => void;
  /** Split a leaf tile, inserting a new leaf with the given session. */
  splitTile: (
    tileId: string,
    direction: 'horizontal' | 'vertical',
    sessionId: string,
    insertBefore?: boolean
  ) => void;
  /** Close (remove) a tile leaf. Exits tiling if tree becomes empty. */
  closeTile: (tileId: string) => void;
  /** Update the sizes of a split node after a resize drag. */
  setTileSizes: (splitId: string, sizes: [number, number]) => void;
  /** Assign a session to a tile leaf. */
  setTileSession: (tileId: string, sessionId: string | null) => void;
  /** Set the active (focused) tile leaf ID. */
  setActiveTile: (tileId: string | null) => void;
  /** Replace the saved tile layouts list (from extension). */
  setSavedTileLayouts: (layouts: SavedTileLayout[]) => void;
  /** Restore a saved layout preset. */
  restoreTileLayout: (layout: SavedTileLayout) => void;
  /** Set per-session activities (for tiled panels). */
  setSessionActivities: (sessionId: string, activities: ActivityEvent[]) => void;
  /** Set per-session conversation (for tiled panels). */
  setSessionConversation: (sessionId: string, turns: ConversationTurn[]) => void;
  /** Update the active drop target during drag-to-tile operations. */
  setDragToTileTarget: (target: { tileId: string; edge: string } | null) => void;
}

/** Resolve the desired detail view mode, preserving TILING when active. */
function resolveDetailMode(current: DetailViewMode, desired: DetailViewMode): DetailViewMode {
  return current === DETAIL_VIEW_MODES.TILING ? DETAIL_VIEW_MODES.TILING : desired;
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
  historyEntries: [],
  usageData: null,
  pendingLaunchSessionId: null,
  pendingAdoptions: new Set(),
  isNestedSession: false,
  monitoringScope: DEFAULT_MONITORING_SCOPE,
  settingsDrawerOpen: false,
  autoHidePatterns: [],
  launchMode: LAUNCH_MODES.NORMAL,
  overviewMode: OVERVIEW_MODES.LIST,
  keyboardFocusedSessionId: null,
  navAnchor: null,
  kanbanSortOrders: {},

  // Tiling state
  tileRoot: null,
  activeTileId: null,
  savedTileLayouts: [],
  activitiesBySession: new Map(),
  conversationBySession: new Map(),
  dragToTileTarget: null,

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
  setFullState: (
    sessions,
    activities,
    conversation,
    toolStats,
    tokenSummaries,
    isNestedSession,
    msgFocusId,
    monitoringScope = DEFAULT_MONITORING_SCOPE
  ) =>
    set((state) => {
      const pending = state.pendingLaunchSessionId;
      const found = pending !== null && sessions.some((s) => s.sessionId === pending);
      // Apply activities/conversation only when the extension's focused session matches
      // the webview's current focus, OR when a pending launch session is being claimed
      // (the pending claim atomically sets focusedSessionId, so the data must accompany it).
      const focusMatch = msgFocusId === state.focusedSessionId || found;
      return {
        sessions,
        ...(focusMatch ? { activities, conversation } : {}),
        toolStats,
        tokenSummaries,
        isNestedSession,
        monitoringScope,
        ...(found
          ? {
              focusedSessionId: pending,
              detailViewMode: resolveDetailMode(state.detailViewMode, DETAIL_VIEW_MODES.SPLIT),
              filteredSubAgentId: null,
              pendingLaunchSessionId: null,
            }
          : {}),
      };
    }),
  setActivities: (activities) => set({ activities }),
  setConversation: (turns) => set({ conversation: turns }),
  setFocusedSession: (sessionId) =>
    set((state) => ({
      focusedSessionId: sessionId,
      detailViewMode: resolveDetailMode(
        state.detailViewMode,
        sessionId ? DETAIL_VIEW_MODES.SPLIT : DETAIL_VIEW_MODES.OVERVIEW_ONLY
      ),
      filteredSubAgentId: null,
      // When in tiling mode and the session is already in a tile, focus that tile
      ...(state.detailViewMode === DETAIL_VIEW_MODES.TILING && state.tileRoot && sessionId
        ? {
            activeTileId: findLeafBySessionId(state.tileRoot, sessionId)?.id ?? state.activeTileId,
          }
        : {}),
    })),
  setFilterMode: (mode) => set({ filterMode: mode }),
  setDetailViewMode: (mode) => set({ detailViewMode: mode }),
  setFilteredSubAgentId: (id) =>
    set((state) => ({
      filteredSubAgentId: state.filteredSubAgentId === id ? null : id,
    })),
  expandFocusedSession: () =>
    set((state) => ({
      detailViewMode: resolveDetailMode(state.detailViewMode, DETAIL_VIEW_MODES.EXPANDED),
    })),
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
    set((state) => ({
      focusedSessionId: null,
      detailViewMode: resolveDetailMode(state.detailViewMode, DETAIL_VIEW_MODES.OVERVIEW_ONLY),
      filteredSubAgentId: null,
    })),
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
  setActiveTab: (tab) => set({ activeTab: tab }),
  setHistoryEntries: (entries) => set({ historyEntries: entries }),
  setUsageData: (data) => set({ usageData: data }),
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
  toggleKanbanSortOrder: (columnKey) =>
    set((state) => {
      const current = state.kanbanSortOrders[columnKey] ?? SORT_DIRECTIONS.DESC;
      return {
        kanbanSortOrders: {
          ...state.kanbanSortOrders,
          [columnKey]:
            current === SORT_DIRECTIONS.DESC ? SORT_DIRECTIONS.ASC : SORT_DIRECTIONS.DESC,
        },
      };
    }),
  setKanbanSortOrders: (sortOrders) => set({ kanbanSortOrders: sortOrders }),
  setKeyboardFocus: (sessionId, anchor) =>
    set({
      keyboardFocusedSessionId: sessionId,
      ...(anchor ? { navAnchor: anchor } : {}),
    }),
  clearKeyboardFocus: () => set({ keyboardFocusedSessionId: null, navAnchor: null }),
  zenModeActive: false,
  zenExitedAt: null,
  enterZenMode: () =>
    set((state) => ({
      zenModeActive: state.sessions.length > 0,
      zenExitedAt: null,
    })),
  exitZenMode: () => set({ zenModeActive: false, zenExitedAt: Date.now() }),

  // ---- Tiling actions ----

  enterTilingMode: (sessionId) => {
    const leafId = generateTileId('l');
    const root: TileNode = { type: 'leaf', id: leafId, sessionId };
    set({
      tileRoot: root,
      activeTileId: leafId,
      detailViewMode: DETAIL_VIEW_MODES.TILING,
    });
  },

  exitTilingMode: () =>
    set({
      tileRoot: null,
      activeTileId: null,
      detailViewMode: DETAIL_VIEW_MODES.OVERVIEW_ONLY,
      activitiesBySession: new Map(),
      conversationBySession: new Map(),
    }),

  splitTile: (tileId, direction, sessionId, insertBefore) =>
    set((state) => {
      if (!state.tileRoot) return {};
      const newRoot = splitNode(state.tileRoot, tileId, direction, sessionId, insertBefore);
      return { tileRoot: newRoot };
    }),

  closeTile: (tileId) =>
    set((state) => {
      if (!state.tileRoot) return {};
      const newRoot = removeNode(state.tileRoot, tileId);
      if (newRoot === null) {
        // Tree is empty — exit tiling mode
        return {
          tileRoot: null,
          activeTileId: null,
          detailViewMode: DETAIL_VIEW_MODES.OVERVIEW_ONLY,
          activitiesBySession: new Map(),
          conversationBySession: new Map(),
        };
      }
      return {
        tileRoot: newRoot,
        // If the closed tile was active, clear active
        activeTileId: state.activeTileId === tileId ? null : state.activeTileId,
      };
    }),

  setTileSizes: (splitId, sizes) =>
    set((state) => {
      if (!state.tileRoot) return {};
      return { tileRoot: updateSizes(state.tileRoot, splitId, sizes) };
    }),

  setTileSession: (tileId, sessionId) =>
    set((state) => {
      if (!state.tileRoot) return {};
      return { tileRoot: setLeafSession(state.tileRoot, tileId, sessionId) };
    }),

  setActiveTile: (tileId) => set({ activeTileId: tileId }),

  setSavedTileLayouts: (layouts) => set({ savedTileLayouts: layouts }),

  restoreTileLayout: (layout) => {
    set({
      tileRoot: layout.root,
      activeTileId: null,
      detailViewMode: DETAIL_VIEW_MODES.TILING,
      layoutOrientation:
        layout.layoutOrientation === 'vertical'
          ? LAYOUT_ORIENTATIONS.VERTICAL
          : LAYOUT_ORIENTATIONS.HORIZONTAL,
      // Clear per-session caches — new subscriptions will repopulate
      activitiesBySession: new Map(),
      conversationBySession: new Map(),
    });
  },

  setSessionActivities: (sessionId, activities) =>
    set((state) => {
      const next = new Map(state.activitiesBySession);
      next.set(sessionId, activities);
      return { activitiesBySession: next };
    }),

  setSessionConversation: (sessionId, turns) =>
    set((state) => {
      const next = new Map(state.conversationBySession);
      next.set(sessionId, turns);
      return { conversationBySession: next };
    }),

  setDragToTileTarget: (target) => set({ dragToTileTarget: target }),
}));
