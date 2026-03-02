/**
 * @module DashboardPanel
 *
 * Manages the webview panel lifecycle and IPC bridge between the extension
 * backend and the React dashboard UI.
 *
 * @remarks
 * Uses a singleton pattern — only one dashboard panel exists at a time.
 * The webview HTML is CSP-secured with a nonce-based script policy.
 * Asset paths (`assets/index.js`, `assets/index.css`) must match the Vite
 * output configuration in `webview-ui/vite.config.ts`.
 */

import * as vscode from 'vscode';
import { SessionTracker } from './monitoring/SessionTracker';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './models/protocol';
import { SessionInfo } from './models/types';
import { ISessionNameStore } from './persistence/ISessionNameStore';
import { ISessionOrderStore } from './persistence/ISessionOrderStore';
import { ISessionVisibilityStore } from './persistence/ISessionVisibilityStore';
import { ISessionLauncher } from './terminal/ISessionLauncher';
import { IPtyBridge } from './terminal/IPtyBridge';
import { ILaunchedSessionStore } from './persistence/ILaunchedSessionStore';
import { ISessionHistoryStore } from './persistence/ISessionHistoryStore';
import { ISessionHistoryService } from './persistence/ISessionHistoryService';
import { IStatsCacheReader } from './persistence/StatsCacheReader';
import { ITileLayoutStore } from './persistence/ITileLayoutStore';
import {
  PANEL_TITLE,
  LOG_PREFIX,
  TIMING,
  PTY,
  SETTINGS,
  LAUNCH_MODES,
  OVERVIEW_MODES,
  WORKSPACE_STATE_KEYS,
  CONTEXT_KEYS,
} from './constants';
import type { LaunchMode, NavDirection, OverviewMode, SortDirection } from './constants';
import { isInsideClaudeSession } from './terminal/SessionLauncher';

/**
 * Singleton webview panel for the Conductor.
 *
 * @remarks
 * Created via {@link createOrShow} and automatically disposed when the user
 * closes the panel. Subscribes to {@link SessionTracker.onStateChanged} to
 * push live updates to the webview.
 */
export class DashboardPanel implements vscode.Disposable {
  public static currentPanel: DashboardPanel | undefined;
  private static readonly viewType = 'conductor';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly sessionTracker: SessionTracker;
  private readonly nameStore: ISessionNameStore;
  private readonly orderStore: ISessionOrderStore;
  private readonly visibilityStore: ISessionVisibilityStore;
  private readonly sessionLauncher: ISessionLauncher;
  private readonly ptyBridge: IPtyBridge;
  // TODO: Extract dependency bag object when parameter count exceeds 10
  private readonly launchedSessionStore: ILaunchedSessionStore;
  private readonly sessionHistoryStore: ISessionHistoryStore;
  private readonly sessionHistoryService: ISessionHistoryService;
  private readonly statsCacheReader: IStatsCacheReader;
  private readonly tileLayoutStore: ITileLayoutStore;
  private readonly workspaceState: vscode.Memento;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingAdoptions = new Set<string>();
  /** Session IDs currently subscribed to per-tile data updates. */
  private readonly subscribedSessionIds = new Set<string>();
  /** Session IDs awaiting JSONL discovery — protects PTY buffers from premature pruning. */
  private readonly pendingDiscoveryIds = new Set<string>();
  /** Session IDs ever launched/adopted by Conductor — survives session exit for launchedByConductor flag persistence. */
  private readonly conductorLaunchedIds: Set<string>;
  /** Maps PTY session ID (resumedId) → displayed session's primary ID for routing. */
  private readonly ptyIdToDisplayId = new Map<string, string>();
  /** sessionId → LaunchMode for Conductor-launched sessions. Persisted to workspaceState. */
  private readonly launchedSessionModes = new Map<string, LaunchMode>();
  /** Tracks recent Conductor resume operations for ghost continuation filtering.
   * Key: cwd, Value: { resumedId: string, timestamp: number } */
  private readonly recentResumes = new Map<string, { resumedId: string; timestamp: number }>();
  private focusedSessionId: string | null = null;
  /** Tracks previous panel visibility to detect hidden→visible transitions. */
  private wasPanelVisible = true;
  private lastSessionIdSet: string = '';
  private cachedOrder: string[] = [];
  private launchDiscoveryTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * Create a new dashboard panel or reveal an existing one.
   *
   * @remarks
   * If a panel already exists, it is revealed in its current column.
   * Otherwise, a new panel is created with scripts enabled and
   * `retainContextWhenHidden: true` to preserve React state.
   *
   * @param context - Extension context (provides the extension URI for asset paths)
   * @param sessionTracker - The session tracker instance to read state from
   * @param nameStore - Persistence layer for user-defined session display names
   * @param orderStore - Persistence layer for user-defined session card order
   * @param visibilityStore - Persistence layer for session visibility (hidden/force-shown)
   * @param sessionLauncher - Launches Claude Code sessions from within Conductor
   * @param ptyBridge - Relays PTY I/O for Conductor-launched sessions
   * @param launchedSessionStore - Persistence layer for Conductor-launched session IDs
   * @param sessionHistoryStore - Persistence layer for session history metadata
   * @param sessionHistoryService - Service that builds history entries for the webview
   * @param statsCacheReader - Reads the Claude Code stats-cache.json for the Usage tab
   * @param tileLayoutStore - Persistence layer for saved tile layout presets
   * @returns The singleton DashboardPanel instance
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    sessionTracker: SessionTracker,
    nameStore: ISessionNameStore,
    orderStore: ISessionOrderStore,
    visibilityStore: ISessionVisibilityStore,
    sessionLauncher: ISessionLauncher,
    ptyBridge: IPtyBridge,
    launchedSessionStore: ILaunchedSessionStore,
    sessionHistoryStore: ISessionHistoryStore,
    sessionHistoryService: ISessionHistoryService,
    statsCacheReader: IStatsCacheReader,
    tileLayoutStore: ITileLayoutStore
  ): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (DashboardPanel.currentPanel) {
      console.log(`${LOG_PREFIX.PANEL} Revealing existing panel`);
      DashboardPanel.currentPanel.panel.reveal(column);
      vscode.commands.executeCommand('setContext', CONTEXT_KEYS.PANEL_FOCUSED, true);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      PANEL_TITLE,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')],
      }
    );

    console.log(`${LOG_PREFIX.PANEL} Creating new dashboard panel`);
    DashboardPanel.currentPanel = new DashboardPanel(
      panel,
      context.extensionUri,
      sessionTracker,
      nameStore,
      orderStore,
      visibilityStore,
      sessionLauncher,
      ptyBridge,
      launchedSessionStore,
      sessionHistoryStore,
      sessionHistoryService,
      statsCacheReader,
      tileLayoutStore,
      context.workspaceState
    );

    return DashboardPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sessionTracker: SessionTracker,
    nameStore: ISessionNameStore,
    orderStore: ISessionOrderStore,
    visibilityStore: ISessionVisibilityStore,
    sessionLauncher: ISessionLauncher,
    ptyBridge: IPtyBridge,
    launchedSessionStore: ILaunchedSessionStore,
    sessionHistoryStore: ISessionHistoryStore,
    sessionHistoryService: ISessionHistoryService,
    statsCacheReader: IStatsCacheReader,
    tileLayoutStore: ITileLayoutStore,
    workspaceState: vscode.Memento
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionTracker = sessionTracker;
    this.nameStore = nameStore;
    this.orderStore = orderStore;
    this.visibilityStore = visibilityStore;
    this.sessionLauncher = sessionLauncher;
    this.ptyBridge = ptyBridge;
    this.launchedSessionStore = launchedSessionStore;
    this.sessionHistoryStore = sessionHistoryStore;
    this.sessionHistoryService = sessionHistoryService;
    this.statsCacheReader = statsCacheReader;
    this.tileLayoutStore = tileLayoutStore;
    this.workspaceState = workspaceState;
    this.conductorLaunchedIds = new Set(this.launchedSessionStore.getAll());
    this.restoreLaunchedSessionModes();

    // Register PtyBridge before spawn to prevent data loss race condition.
    // For continuation sessions (auto-reconnect), route PTY data to the primary display ID.
    this.sessionLauncher.setPreSpawnCallback((sid) => {
      const members = this.sessionTracker.getGroupMembers(sid);
      const primaryId = members.length > 1 ? members[0] : undefined;
      if (primaryId && primaryId !== sid) {
        this.ptyIdToDisplayId.set(sid, primaryId);
        this.ptyBridge.registerSession(primaryId);
        console.log(
          `${LOG_PREFIX.PANEL} PTY ${sid.slice(0, 8)} → display ${primaryId.slice(0, 8)}`
        );
      } else {
        this.ptyBridge.registerSession(sid);
      }
    });

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.sessionTracker.onStateChanged(() => this.postFullState(), null, this.disposables);

    this.nameStore.onNamesChanged(() => this.postFullState(), null, this.disposables);
    this.orderStore.onOrderChanged(
      () => {
        this.cachedOrder = this.orderStore.getOrder();
        // Invalidate hash so reconcileOrderIfNeeded() runs on next postFullState().
        // This may cause reconcile to call setOrder() again if it prunes stale IDs,
        // triggering one more onOrderChanged cycle — but the system converges because
        // the hash will match on the subsequent pass.
        this.lastSessionIdSet = '';
        this.postFullState();
      },
      null,
      this.disposables
    );

    this.visibilityStore.onVisibilityChanged(() => this.postFullState(), null, this.disposables);

    // Track panel focus state for keybinding `when` clauses
    this.panel.onDidChangeViewState(
      (e) => {
        vscode.commands.executeCommand(
          'setContext',
          CONTEXT_KEYS.PANEL_FOCUSED,
          e.webviewPanel.active
        );

        // Notify webview on hidden→visible transition so it can force a layout recalculation.
        // Without this, ResizeObserver callbacks don't fire and the UI stays garbled.
        const nowVisible = e.webviewPanel.visible;
        if (nowVisible && !this.wasPanelVisible) {
          console.log(`${LOG_PREFIX.PANEL} Panel became visible — sending panel:visible`);
          this.postMessage({ type: 'panel:visible' });
        }
        this.wasPanelVisible = nowVisible;
      },
      null,
      this.disposables
    );

    // Set initial focus context — onDidChangeViewState doesn't fire on creation
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.PANEL_FOCUSED, true);

    // Wire PTY data from SessionLauncher → PtyBridge ring buffer + webview
    this.sessionLauncher.onPtyData(
      ({ sessionId, data }) => {
        const displayId = this.ptyIdToDisplayId.get(sessionId) ?? sessionId;
        this.ptyBridge.pushData(displayId, data);
        this.postMessage({ type: 'pty:data', sessionId: displayId, data });
      },
      null,
      this.disposables
    );

    // NOTE: We intentionally do NOT unregister PtyBridge buffers on session exit.
    // Buffers are retained for replay on webview reload. Orphans are pruned in postFullState().
  }

  /**
   * Send the complete dashboard state to the webview.
   *
   * @remarks
   * Posts four separate IPC messages: sessions, activities, tool stats,
   * and token summaries. Called on initial webview mount (`ready` message)
   * and on every {@link SessionTracker.onStateChanged} event.
   */
  public postFullState(): void {
    const state = this.sessionTracker.getState(this.focusedSessionId);
    const named = this.applyCustomNames(state.sessions);
    const filtered = this.filterGhostContinuations(named);
    const visible = this.applyVisibility(filtered);
    const sessions = this.applyCustomOrder(visible);
    console.log(
      `${LOG_PREFIX.PANEL} Posting state → ${sessions.length} sessions, ${state.activities.length} activities, ${state.toolStats.length} tools, ${state.tokenSummaries.length} token summaries`
    );

    this.postMessage({
      type: 'state:full',
      sessions,
      activities: state.activities,
      conversation: state.conversation,
      toolStats: state.toolStats,
      tokenSummaries: state.tokenSummaries,
      isNestedSession: isInsideClaudeSession(),
      focusedSessionId: this.focusedSessionId,
      monitoringScope: this.sessionTracker.getMonitoringScope(),
    });

    // Prune PTY buffers for sessions that SessionTracker no longer knows about.
    // Include continuation member IDs so buffers registered under a continuation
    // member (via preSpawnCallback) are not incorrectly pruned.
    const knownIds = new Set(state.sessions.map((s) => s.sessionId));
    for (const session of state.sessions) {
      if (session.continuationSessionIds) {
        for (const id of session.continuationSessionIds) {
          knownIds.add(id);
        }
      }
    }
    this.pruneOrphanedPtyBuffers(knownIds);

    // Update history store with latest display names and metadata from live sessions
    this.updateHistoryFromLiveSessions(state.sessions);

    // Emit per-session data for each tile subscription
    for (const sessionId of this.subscribedSessionIds) {
      this.postSessionActivities(sessionId);
      this.postSessionConversation(sessionId);
    }
  }

  /**
   * Programmatically focus a session from the extension side.
   *
   * @remarks
   * Sets the focused session, sends filtered activities/conversation to the webview,
   * and notifies the webview to update its selection state via `session:focus-command`.
   * Used by the Quick Pick session switcher.
   *
   * @param sessionId - The session ID to focus
   */
  public focusSession(sessionId: string): void {
    console.log(`${LOG_PREFIX.PANEL} Focusing session from extension: ${sessionId}`);
    this.focusedSessionId = sessionId;
    this.postMessage({ type: 'session:focus-command', sessionId });
    this.postActivities();
    this.postConversation();
  }

  /**
   * Forward a spatial navigation command to the webview.
   * Called by nav commands registered in extension.ts.
   *
   * @param direction - The direction to navigate
   */
  public navigate(direction: NavDirection): void {
    this.postMessage({ type: 'nav:move', direction });
  }

  /**
   * Forward a nav-select command to the webview.
   * Called by the navSelect command registered in extension.ts.
   */
  public selectKeyboardFocused(): void {
    this.postMessage({ type: 'nav:select' });
  }

  /**
   * Inject terminal key data by posting to the webview (routes through TerminalView's sessionId).
   *
   * @param data - Escape sequence string to inject into the active terminal
   */
  public injectTerminalKeys(data: string): void {
    this.postMessage({ type: 'terminal:inject-keys', data });
  }

  /**
   * Notify the panel that a session was launched (from either the webview or command palette).
   * Posts launch-status to the webview and starts polling for the JSONL file.
   *
   * @param sessionId - The launched session's UUID
   * @param cwd - Optional working directory to persist for auto-reconnect
   */
  public notifySessionLaunched(sessionId: string, cwd?: string): void {
    this.conductorLaunchedIds.add(sessionId);
    this.pendingDiscoveryIds.add(sessionId);
    const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.launchedSessionStore.save(sessionId, resolvedCwd).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to persist launched session: ${err}`);
    });
    this.saveInitialHistoryMetadata(sessionId);
    this.ptyBridge.registerSession(sessionId);
    this.postMessage({
      type: 'session:launch-status',
      sessionId,
      status: 'launched',
    });
    this.startLaunchDiscoveryPoll(sessionId);
  }

  /**
   * Notify the webview that an auto-reconnected session has a terminal available.
   * Resolves continuation member ID to primary/display ID before posting.
   * @param sessionId The session ID of the reconnected session.
   */
  public notifySessionReconnected(sessionId: string): void {
    this.conductorLaunchedIds.add(sessionId);
    const members = this.sessionTracker.getGroupMembers(sessionId);
    const displayId = members.length > 0 ? members[0] : sessionId;

    // Track resume for ghost continuation filtering
    const state = this.sessionTracker.getState(null);
    const session = state.sessions.find((s) => s.sessionId === sessionId);
    if (session?.cwd) {
      this.recentResumes.set(session.cwd, { resumedId: sessionId, timestamp: Date.now() });
    }

    this.postMessage({
      type: 'session:adopt-status',
      sessionId: displayId,
      status: 'adopted',
    });
    console.log(`${LOG_PREFIX.PANEL} Session ${sessionId} reconnected → display ${displayId}`);
  }

  private startLaunchDiscoveryPoll(sessionId: string): void {
    this.clearLaunchDiscoveryTimer();
    let retries = 0;
    this.launchDiscoveryTimer = setInterval(() => {
      this.sessionTracker.refresh(TIMING.LAUNCH_DISCOVERY_MAX_AGE_MS);
      const found = this.sessionTracker
        .getState(null)
        .sessions.some((s) => s.sessionId === sessionId);
      if (found || ++retries >= TIMING.LAUNCH_DISCOVERY_MAX_RETRIES) {
        this.clearLaunchDiscoveryTimer();
        this.pendingDiscoveryIds.delete(sessionId);
      }
      this.postFullState();
    }, TIMING.LAUNCH_DISCOVERY_POLL_MS);
  }

  private clearLaunchDiscoveryTimer(): void {
    if (this.launchDiscoveryTimer !== undefined) {
      clearInterval(this.launchDiscoveryTimer);
      this.launchDiscoveryTimer = undefined;
    }
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Send only the activity feed to the webview.
   *
   * @remarks
   * Uses {@link SessionTracker.getFilteredActivities} to avoid assembling
   * the full dashboard state (sessions, tool stats, tokens are unaffected).
   */
  private postActivities(): void {
    const activities = this.sessionTracker.getFilteredActivities(this.focusedSessionId);
    this.postMessage({
      type: 'activity:full',
      events: activities,
      sessionId: this.focusedSessionId,
    });
  }

  /**
   * Send all buffered PTY data to the webview as a single bulk replay message.
   * Called on `ready` so the webview can restore terminal output after reload.
   */
  private replayPtyBuffers(): void {
    const registeredIds = this.ptyBridge.getRegisteredSessionIds();
    const buffers: Record<string, string> = {};
    for (const sessionId of registeredIds) {
      const data = this.ptyBridge.getBufferedData(sessionId);
      if (data) {
        buffers[sessionId] = data;
      }
    }
    if (Object.keys(buffers).length > 0) {
      console.log(
        `${LOG_PREFIX.PANEL} Replaying PTY buffers for ${Object.keys(buffers).length} session(s)`
      );
      this.postMessage({ type: 'pty:buffers', buffers });
    }
  }

  /**
   * Send only the conversation transcript to the webview.
   *
   * @remarks
   * Uses {@link SessionTracker.getFilteredConversation} to send focused-session
   * conversation turns without assembling the full dashboard state.
   */
  private postConversation(): void {
    const conversation = this.sessionTracker.getFilteredConversation(this.focusedSessionId);
    this.postMessage({
      type: 'conversation:full',
      turns: conversation,
      sessionId: this.focusedSessionId,
    });
  }

  private handleMessage(message: WebviewToExtensionMessage): void {
    console.log(`${LOG_PREFIX.PANEL} Webview message received: ${message.type}`);
    switch (message.type) {
      case 'ready':
        this.postFullState();
        this.replayPtyBuffers();
        this.postCurrentSettings();
        this.postCurrentLaunchMode();
        this.postCurrentOverviewMode();
        this.postCurrentKanbanSortOrders();
        this.postCurrentTileLayouts();
        break;
      case 'session:focus':
        this.focusedSessionId = message.sessionId;
        this.postActivities();
        this.postConversation();
        break;
      case 'refresh':
        this.sessionTracker.refresh();
        this.postFullState();
        break;
      case 'session:rename':
        this.handleRename(message.sessionId, message.name);
        break;
      case 'session:reorder':
        this.handleReorder(message.sessionIds);
        break;
      case 'user:send-input':
        this.handleSendInput(message.sessionId, message.text);
        break;
      case 'session:launch':
        this.handleLaunch(message.cwd, message.mode);
        break;
      case 'session:set-launch-mode':
        this.handleSetLaunchMode(message.mode);
        break;
      case 'overview-mode:set':
        this.handleSetOverviewMode(message.mode);
        break;
      case 'kanban-sort-orders:set':
        this.handleSetKanbanSortOrders(message.sortOrders);
        break;
      case 'session:hide':
        this.handleHide(message.sessionId);
        break;
      case 'session:unhide':
        this.handleUnhide(message.sessionId);
        break;
      case 'session:adopt':
        this.handleAdopt(message.sessionId);
        break;
      case 'pty:input':
        this.sessionLauncher.writeInput(this.resolvePtySessionId(message.sessionId), message.data);
        break;
      case 'pty:resize': {
        const ptyId = this.resolvePtySessionId(message.sessionId);
        this.sessionLauncher.resize(ptyId, message.cols, message.rows);
        break;
      }
      case 'settings:get':
        this.postCurrentSettings();
        break;
      case 'settings:update':
        this.handleSettingsUpdate(message.autoHidePatterns);
        break;
      case 'history:request':
        this.handleHistoryRequest();
        break;
      case 'history:resume':
        this.handleHistoryResume(message.sessionId);
        break;
      case 'usage:request':
        this.handleUsageRequest();
        break;
      case 'nav:keyboard-focus-changed':
        vscode.commands.executeCommand(
          'setContext',
          CONTEXT_KEYS.KEYBOARD_NAV_ACTIVE,
          message.active
        );
        break;
      case 'terminal:view-changed':
        vscode.commands.executeCommand(
          'setContext',
          CONTEXT_KEYS.TERMINAL_VIEW_SHOWING,
          message.active
        );
        break;
      case 'tile:subscribe':
        this.handleTileSubscribe(message.sessionId);
        break;
      case 'tile:unsubscribe':
        this.handleTileUnsubscribe(message.sessionId);
        break;
      case 'tile-layouts:save':
        this.handleTileLayoutsSave(message.layouts);
        break;
      case 'session:show-terminal': {
        const ptyId = this.resolvePtySessionId(message.sessionId);
        this.sessionLauncher.showTerminal(ptyId);
        break;
      }
    }
  }

  // ── IPC status helpers ───────────────────────────────────────────────

  private postInputStatus(sessionId: string, status: 'sent' | 'adopting'): void {
    this.postMessage({ type: 'user:input-status', sessionId, status });
  }

  private postInputError(sessionId: string, err: unknown): void {
    this.postMessage({
      type: 'user:input-status',
      sessionId,
      status: 'error',
      error: String(err),
    });
  }

  // ── Message handlers ─────────────────────────────────────────────────

  private handleRename(sessionId: string, name: string): void {
    console.log(`${LOG_PREFIX.PANEL} Renaming session ${sessionId} → "${name}"`);
    // Store under the primary ID (which is the sessionId of merged sessions).
    // Clear stale custom names on non-primary member IDs to prevent ghost resurfaces.
    const renamePromises: Promise<void>[] = [this.nameStore.setName(sessionId, name)];
    const state = this.sessionTracker.getState(this.focusedSessionId);
    const targetSession = state.sessions.find((s) => s.sessionId === sessionId);
    if (targetSession?.continuationSessionIds) {
      for (const memberId of targetSession.continuationSessionIds) {
        if (memberId !== sessionId && this.nameStore.getName(memberId)) {
          renamePromises.push(this.nameStore.setName(memberId, ''));
        }
      }
    }
    Promise.all(renamePromises).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to rename session: ${err}`);
      this.postFullState();
    });
  }

  private handleReorder(sessionIds: string[]): void {
    const reorderedSet = new Set(sessionIds);
    const existingOrder = this.orderStore.getOrder();
    const unlisted = existingOrder.filter((id) => !reorderedSet.has(id));
    const mergedOrder = [...sessionIds, ...unlisted];

    console.log(
      `${LOG_PREFIX.PANEL} Reordering sessions: ${sessionIds.length} reordered, ${unlisted.length} preserved, ${mergedOrder.length} total`
    );

    this.orderStore.setOrder(mergedOrder).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to persist session order: ${err}`);
    });
  }

  private handleSendInput(sessionId: string, text: string): void {
    // For merged sessions, route to the most recent continuation member's terminal
    const targetId = this.sessionTracker.getMostRecentContinuationMember(sessionId);

    if (this.sessionLauncher.isLaunchedSession(targetId)) {
      // Path A: targetId itself owns a terminal
      console.log(`${LOG_PREFIX.PANEL} Input → direct write to ${targetId}`);
      this.sessionLauncher.writeInput(targetId, text + PTY.INPUT_SUBMIT);
      this.postInputStatus(sessionId, 'sent');
      return;
    }

    const launchedMember = this.findLaunchedGroupMember(sessionId);
    if (launchedMember) {
      // Path B: a continuation group member owns a terminal
      console.log(
        `${LOG_PREFIX.PANEL} Input → group member write via ${launchedMember} (target was ${targetId})`
      );
      this.sessionLauncher.writeInput(launchedMember, text + PTY.INPUT_SUBMIT);
      this.postInputStatus(sessionId, 'sent');
      return;
    }

    // Path C: no terminal in group — adopt via resume()
    const groupMembers = this.sessionTracker.getGroupMembers(sessionId);
    const primaryId = groupMembers[0]; // earliest member = primary
    if (this.pendingAdoptions.has(primaryId)) {
      this.postInputStatus(sessionId, 'sent');
      return;
    }

    console.log(`${LOG_PREFIX.PANEL} Input → adopting session ${targetId}`);
    this.postInputStatus(sessionId, 'adopting');

    this.adoptSession(sessionId, text)
      .then(() => {
        this.postInputStatus(sessionId, 'sent');
        this.postMessage({
          type: 'session:adopt-status',
          sessionId,
          status: 'adopted',
        });
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to adopt session: ${err}`);
        this.postInputError(sessionId, err);
      });
  }

  private handleLaunch(cwd?: string, mode?: LaunchMode): void {
    const launchMode = mode ?? LAUNCH_MODES.NORMAL;
    console.log(`${LOG_PREFIX.PANEL} Launching new session (mode: ${launchMode})`);
    this.sessionLauncher
      .launch(cwd, launchMode)
      .then((launchedId) => {
        console.log(`${LOG_PREFIX.PANEL} Session launched: ${launchedId}`);
        if (launchMode !== LAUNCH_MODES.NORMAL) {
          this.launchedSessionModes.set(launchedId, launchMode);
          this.persistLaunchedSessionModes();
        }
        this.notifySessionLaunched(launchedId, cwd);
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to launch session: ${err}`);
        this.postMessage({
          type: 'session:launch-status',
          status: 'error',
          error: String(err),
        });
      });
  }

  private handleHide(sessionId: string): void {
    console.log(`${LOG_PREFIX.PANEL} Hiding session ${sessionId}`);
    const state = this.sessionTracker.getState(this.focusedSessionId);
    const target = state.sessions.find((s) => s.sessionId === sessionId);
    if (target?.isArtifact && !target.launchedByConductor) {
      this.visibilityStore.unforceShowSession(sessionId).catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to hide artifact session: ${err}`);
      });
    } else {
      this.visibilityStore.hideSession(sessionId).catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to hide session: ${err}`);
      });
    }
  }

  private handleUnhide(sessionId: string): void {
    console.log(`${LOG_PREFIX.PANEL} Unhiding session ${sessionId}`);
    if (this.visibilityStore.getHiddenIds().has(sessionId)) {
      this.visibilityStore.unhideSession(sessionId).catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to unhide session: ${err}`);
      });
    } else {
      this.visibilityStore.forceShowSession(sessionId).catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to force-show session: ${err}`);
      });
    }
  }

  private handleAdopt(sessionId: string): void {
    console.log(`${LOG_PREFIX.PANEL} Adopting session ${sessionId} for terminal mode`);
    this.adoptSession(sessionId, '')
      .then(() => {
        this.postMessage({
          type: 'session:adopt-status',
          sessionId,
          status: 'adopted',
        });
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to adopt session: ${err}`);
        this.postMessage({
          type: 'session:adopt-status',
          sessionId,
          status: 'error',
          error: String(err),
        });
      });
  }

  // ── Settings helpers ─────────────────────────────────────────────────

  /** Read the current auto-hide patterns from VS Code settings and post to the webview. */
  private postCurrentSettings(): void {
    const config = vscode.workspace.getConfiguration();
    const autoHidePatterns = config.get<string[]>(SETTINGS.AUTO_HIDE_PATTERNS) ?? [];
    this.postMessage({ type: 'settings:current', autoHidePatterns });
  }

  /**
   * Persist updated auto-hide patterns to VS Code settings and echo back to webview.
   * @param autoHidePatterns - Updated list of auto-hide substring patterns
   */
  private handleSettingsUpdate(autoHidePatterns: string[]): void {
    console.log(
      `${LOG_PREFIX.PANEL} Updating autoHidePatterns: ${autoHidePatterns.length} pattern(s)`
    );
    const config = vscode.workspace.getConfiguration();
    Promise.resolve(
      config.update(
        SETTINGS.AUTO_HIDE_PATTERNS,
        autoHidePatterns,
        vscode.ConfigurationTarget.Global
      )
    )
      .then(() => {
        this.postCurrentSettings();
        // Re-emit full state so artifact flags are re-evaluated with the new patterns
        this.postFullState();
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to update settings: ${err}`);
      });
  }

  // ── Launch mode helpers ─────────────────────────────────────────────

  /** Send the persisted launch mode preference to the webview. */
  private postCurrentLaunchMode(): void {
    const mode = this.workspaceState.get<LaunchMode>(
      WORKSPACE_STATE_KEYS.LAUNCH_MODE,
      LAUNCH_MODES.NORMAL
    );
    this.postMessage({ type: 'launch-mode:current', mode });
  }

  /**
   * Persist the user's launch mode preference from the webview dropdown.
   * @param mode - The launch mode to persist
   */
  private handleSetLaunchMode(mode: LaunchMode): void {
    console.log(`${LOG_PREFIX.PANEL} Setting launch mode: ${mode}`);
    Promise.resolve(this.workspaceState.update(WORKSPACE_STATE_KEYS.LAUNCH_MODE, mode)).catch(
      (err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to persist launch mode: ${err}`);
      }
    );
  }

  // ── Overview mode helpers ───────────────────────────────────────────

  /** Send the persisted overview mode preference to the webview. */
  private postCurrentOverviewMode(): void {
    const mode = this.workspaceState.get<OverviewMode>(
      WORKSPACE_STATE_KEYS.OVERVIEW_MODE,
      OVERVIEW_MODES.LIST
    );
    this.postMessage({ type: 'overview-mode:current', mode });
  }

  /**
   * Persist the user's overview mode preference from the webview toggle.
   * @param mode - The overview mode to persist
   */
  private handleSetOverviewMode(mode: OverviewMode): void {
    console.log(`${LOG_PREFIX.PANEL} Setting overview mode: ${mode}`);
    Promise.resolve(this.workspaceState.update(WORKSPACE_STATE_KEYS.OVERVIEW_MODE, mode)).catch(
      (err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to persist overview mode: ${err}`);
      }
    );
  }

  // ── Kanban sort order helpers ───────────────────────────────────────

  /** Send the persisted kanban sort orders to the webview. */
  private postCurrentKanbanSortOrders(): void {
    const sortOrders = this.workspaceState.get<Record<string, SortDirection>>(
      WORKSPACE_STATE_KEYS.KANBAN_SORT_ORDERS,
      {}
    );
    this.postMessage({ type: 'kanban-sort-orders:current', sortOrders });
  }

  /**
   * Persist the user's kanban sort orders from the webview.
   * @param sortOrders - The per-column sort directions to persist
   */
  private handleSetKanbanSortOrders(sortOrders: Record<string, SortDirection>): void {
    console.log(`${LOG_PREFIX.PANEL} Setting kanban sort orders`);
    Promise.resolve(
      this.workspaceState.update(WORKSPACE_STATE_KEYS.KANBAN_SORT_ORDERS, sortOrders)
    ).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to persist kanban sort orders: ${err}`);
    });
  }

  // ── Tile layout helpers ─────────────────────────────────────────────

  /** Send the persisted tile layout presets to the webview. */
  private postCurrentTileLayouts(): void {
    const layouts = this.tileLayoutStore.getLayouts();
    this.postMessage({ type: 'tile-layouts:current', layouts });
  }

  /**
   * Subscribe to per-session data updates for a tile.
   * @param sessionId The session ID to subscribe to.
   */
  private handleTileSubscribe(sessionId: string): void {
    this.subscribedSessionIds.add(sessionId);
    console.log(
      `${LOG_PREFIX.PANEL} Tile subscribe: ${sessionId.slice(0, 8)} (${this.subscribedSessionIds.size} total)`
    );
    this.postSessionActivities(sessionId);
    this.postSessionConversation(sessionId);
  }

  /**
   * Unsubscribe from per-session data updates for a tile.
   * @param sessionId The session ID to unsubscribe from.
   */
  private handleTileUnsubscribe(sessionId: string): void {
    this.subscribedSessionIds.delete(sessionId);
    console.log(
      `${LOG_PREFIX.PANEL} Tile unsubscribe: ${sessionId.slice(0, 8)} (${this.subscribedSessionIds.size} total)`
    );
  }

  /**
   * Persist tile layout presets from the webview.
   * @param layouts The tile layout presets to persist.
   */
  private handleTileLayoutsSave(layouts: import('./models/types').SavedTileLayout[]): void {
    console.log(`${LOG_PREFIX.PANEL} Saving ${layouts.length} tile layout(s)`);
    this.tileLayoutStore.setLayouts(layouts).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to persist tile layouts: ${err}`);
    });
  }

  /**
   * Send activities for a specific session (used by tile subscriptions).
   * @param sessionId The session ID to send activities for.
   */
  private postSessionActivities(sessionId: string): void {
    const activities = this.sessionTracker.getFilteredActivities(sessionId);
    this.postMessage({ type: 'activity:full', events: activities, sessionId });
  }

  /**
   * Send conversation for a specific session (used by tile subscriptions).
   * @param sessionId The session ID to send conversation for.
   */
  private postSessionConversation(sessionId: string): void {
    const conversation = this.sessionTracker.getFilteredConversation(sessionId);
    this.postMessage({ type: 'conversation:full', turns: conversation, sessionId });
  }

  /** Restore launchedSessionModes from workspace state on construction. */
  private restoreLaunchedSessionModes(): void {
    const stored = this.workspaceState.get<Record<string, string>>(
      WORKSPACE_STATE_KEYS.LAUNCHED_SESSION_MODES,
      {}
    );
    for (const [sessionId, mode] of Object.entries(stored)) {
      this.launchedSessionModes.set(sessionId, mode as LaunchMode);
    }
  }

  /** Persist launchedSessionModes to workspace state. */
  private persistLaunchedSessionModes(): void {
    const record: Record<string, string> = {};
    for (const [sessionId, mode] of this.launchedSessionModes) {
      record[sessionId] = mode;
    }
    Promise.resolve(
      this.workspaceState.update(WORKSPACE_STATE_KEYS.LAUNCHED_SESSION_MODES, record)
    ).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.PANEL} Failed to persist launched session modes: ${err}`);
    });
  }

  /**
   * Pure sort: reorder sessions according to the cached order. No side effects.
   * Sessions not present in `order` are appended at the end to ensure no session
   * is ever silently dropped.
   *
   * @param sessions - Sessions to sort
   * @param order - Ordered session IDs
   * @returns Sessions reordered by the given ID order, with unlisted sessions appended
   */
  private sortByOrder(sessions: SessionInfo[], order: string[]): SessionInfo[] {
    if (order.length === 0) return [...sessions];

    const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));
    const seen = new Set<string>();
    const result: SessionInfo[] = [];

    for (const id of order) {
      const session = sessionMap.get(id);
      if (session) {
        result.push(session);
        seen.add(id);
      }
    }

    // Append sessions not in the order array so they're never silently dropped
    for (const session of sessions) {
      if (!seen.has(session.sessionId)) {
        result.push(session);
      }
    }

    return result;
  }

  /**
   * Check if the session set changed and reconcile/persist the order if needed.
   *
   * NOTE: The hash only detects session-set changes (add/remove), not order changes.
   * Order-change invalidation is handled by the onOrderChanged handler which
   * directly updates cachedOrder before calling postFullState().
   *
   * @param sessions - Current live sessions to reconcile against stored order
   */
  private reconcileOrderIfNeeded(sessions: SessionInfo[]): void {
    const currentIdHash = sessions
      .map((s) => s.sessionId)
      .sort()
      .join(',');

    if (currentIdHash === this.lastSessionIdSet) return;

    // Session set changed — reconcile stored order with live sessions
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    const storedOrder = this.orderStore.getOrder();
    const pruned = storedOrder.filter((id) => liveIds.has(id));

    const prunedSet = new Set(pruned);
    const newSessions = sessions
      .filter((s) => !prunedSet.has(s.sessionId))
      .sort((a, b) => {
        const timeDiff = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        return timeDiff !== 0 ? timeDiff : a.sessionId.localeCompare(b.sessionId);
      })
      .map((s) => s.sessionId);

    const newOrder = [...pruned, ...newSessions];
    this.lastSessionIdSet = currentIdHash;
    this.cachedOrder = newOrder;

    if (newOrder.join(',') !== storedOrder.join(',')) {
      this.orderStore.setOrder(newOrder).catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to persist reconciled order: ${err}`);
      });
    }
  }

  private applyCustomOrder(sessions: SessionInfo[]): SessionInfo[] {
    this.reconcileOrderIfNeeded(sessions);
    return this.sortByOrder(sessions, this.cachedOrder);
  }

  private applyVisibility(sessions: SessionInfo[]): SessionInfo[] {
    // Build live IDs including continuation group member IDs (merged into parent).
    // This prevents pruning member IDs that are valid but not in the final list.
    const liveIds = new Set(sessions.map((s) => s.sessionId));
    for (const id of this.sessionTracker.getContinuationMemberIds()) {
      liveIds.add(id);
    }

    // Prune silently — pruneStaleIds does NOT fire onVisibilityChanged,
    // preventing infinite postFullState() → prune → event → postFullState() loops.
    this.visibilityStore
      .pruneStaleIds(liveIds)
      .catch((err) => console.log(`${LOG_PREFIX.PANEL} Failed to prune visibility: ${err}`));

    const hiddenIds = this.visibilityStore.getHiddenIds();
    const forceShownIds = this.visibilityStore.getForceShownIds();
    return sessions.map((s) => {
      const hidden =
        hiddenIds.has(s.sessionId) ||
        (s.isArtifact && !forceShownIds.has(s.sessionId) && !s.launchedByConductor);
      return hidden ? { ...s, isHidden: true } : s;
    });
  }

  /**
   * Filter out ghost continuation sessions created by Conductor resume operations.
   *
   * @remarks
   * When `adoptSession` or `notifySessionReconnected` resumes a session with
   * `claude --resume <id>`, Claude Code creates a new JSONL file with a fresh
   * session ID. Until the ContinuationGrouper merges it (needs a slug record),
   * the new session appears as a ghost card with 0 turns and 0 tokens.
   *
   * This is a transient display-time filter — never written to visibilityStore.
   *
   * @param sessions - Sessions to filter
   * @returns Sessions with ghost continuations removed
   */
  private filterGhostContinuations(sessions: SessionInfo[]): SessionInfo[] {
    const now = Date.now();
    // Prune expired entries
    for (const [cwd, entry] of this.recentResumes) {
      if (now - entry.timestamp > TIMING.GHOST_CONTINUATION_WINDOW_MS) {
        this.recentResumes.delete(cwd);
      }
    }
    if (this.recentResumes.size === 0) {
      return sessions;
    }
    return sessions.filter((s) => {
      if (
        s.turnCount === 0 &&
        s.totalInputTokens === 0 &&
        s.totalOutputTokens === 0 &&
        !s.isSubAgent &&
        !this.conductorLaunchedIds.has(s.sessionId) &&
        s.cwd &&
        this.recentResumes.has(s.cwd)
      ) {
        console.log(
          `${LOG_PREFIX.PANEL} Filtering ghost continuation ${s.sessionId} (cwd: ${s.cwd})`
        );
        return false;
      }
      return true;
    });
  }

  /**
   * Adopt an external session by resuming it in a VS Code terminal.
   * Passes all continuation group members as search candidates so ProcessDiscovery
   * can find the terminal regardless of which member ID it was started with.
   *
   * @param sessionId - The session ID to adopt (any group member)
   * @param text - Message to deliver via `--print` (empty = adopt only)
   */
  private async adoptSession(sessionId: string, text: string): Promise<void> {
    const groupMembers = this.sessionTracker.getGroupMembers(sessionId);
    const primaryId = groupMembers[0]; // earliest member = primary

    if (this.pendingAdoptions.has(primaryId)) {
      return;
    }

    const alreadyLaunched = this.findLaunchedGroupMember(sessionId);
    if (alreadyLaunched) {
      console.log(
        `${LOG_PREFIX.PANEL} Session ${sessionId} already has a terminal (${alreadyLaunched}), skipping adopt`
      );
      return;
    }

    this.pendingAdoptions.add(primaryId);

    const state = this.sessionTracker.getState(null);
    // Get CWD from any group member that has one
    const sessionCwd = groupMembers
      .map((id) => state.sessions.find((s) => s.sessionId === id)?.cwd)
      .find(Boolean);

    try {
      // Pass all group members — transfer() will find which terminal is running which ID
      const resumedId = await this.sessionLauncher.transfer(
        sessionId,
        text,
        sessionCwd,
        groupMembers
      );
      this.conductorLaunchedIds.add(resumedId);

      // Track resume for ghost continuation filtering
      if (sessionCwd) {
        this.recentResumes.set(sessionCwd, { resumedId, timestamp: Date.now() });
      }

      // Map PTY session ID → displayed session's primary ID for routing
      if (resumedId !== sessionId) {
        const primaryId = groupMembers[0];
        this.ptyIdToDisplayId.set(resumedId, primaryId);
        this.ptyBridge.registerSession(primaryId);
      }

      this.launchedSessionStore.save(resumedId, sessionCwd).catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to persist adopted session: ${err}`);
      });
      this.saveInitialHistoryMetadata(resumedId);
    } finally {
      this.pendingAdoptions.delete(primaryId);
    }
  }

  /**
   * Search the continuation group for a member that owns a Conductor-launched terminal.
   *
   * @param sessionId - Any session ID (may be primary or non-primary member)
   * @returns The launched member's session ID, or undefined if none found
   */
  private findLaunchedGroupMember(sessionId: string): string | undefined {
    const members = this.sessionTracker.getGroupMembers(sessionId);
    return members.find((id) => this.sessionLauncher.isLaunchedSession(id));
  }

  /**
   * Resolve a webview display ID to the actual PTY session ID for input routing.
   *
   * @remarks
   * The webview sends the display ID (primary session ID) for pty:input/pty:resize,
   * but the actual PTY process may be running under a continuation member ID.
   * This method checks the reverse mapping from ptyIdToDisplayId.
   *
   * @param displayId - The display session ID from the webview
   * @returns The actual PTY session ID to route input to
   */
  private resolvePtySessionId(displayId: string): string {
    // Fast path: displayId itself is a launched session (fresh launch, no continuation)
    if (this.sessionLauncher.isLaunchedSession(displayId)) {
      return displayId;
    }
    // Reverse lookup: find the PTY session ID that maps to this display ID
    for (const [ptyId, dId] of this.ptyIdToDisplayId) {
      if (dId === displayId && this.sessionLauncher.isLaunchedSession(ptyId)) {
        return ptyId;
      }
    }
    return displayId;
  }

  /**
   * Remove PtyBridge buffers and conductorLaunchedIds entries for sessions
   * no longer tracked by SessionTracker.
   * @param knownSessionIds - Set of currently tracked session IDs
   */
  private pruneOrphanedPtyBuffers(knownSessionIds: Set<string>): void {
    const toRemove: string[] = [];
    for (const sessionId of this.ptyBridge.getRegisteredSessionIds()) {
      if (!knownSessionIds.has(sessionId) && !this.pendingDiscoveryIds.has(sessionId)) {
        toRemove.push(sessionId);
      }
    }
    let modesChanged = false;
    for (const sessionId of toRemove) {
      this.ptyBridge.unregisterSession(sessionId);
      this.conductorLaunchedIds.delete(sessionId);
      if (this.launchedSessionModes.delete(sessionId)) {
        modesChanged = true;
      }
      // NOTE: We intentionally do NOT call launchedSessionStore.remove() here.
      // The store's TTL handles natural expiry. Keeping entries allows the History
      // tab to show sessions that have left SessionTracker's active memory.
    }
    if (modesChanged) {
      this.persistLaunchedSessionModes();
    }
    if (toRemove.length > 0) {
      console.log(`${LOG_PREFIX.PANEL} Pruned ${toRemove.length} orphaned PTY buffer(s)`);
    }

    // Clean up stale ptyIdToDisplayId entries for dead PTY sessions
    for (const [ptyId] of this.ptyIdToDisplayId) {
      if (!this.sessionLauncher.isLaunchedSession(ptyId)) {
        this.ptyIdToDisplayId.delete(ptyId);
      }
    }
  }

  // ── Usage helpers ───────────────────────────────────────────────────

  /** Handle the webview requesting usage stats for the Usage tab. */
  private async handleUsageRequest(): Promise<void> {
    const stats = await this.statsCacheReader.read();
    this.postMessage({ type: 'usage:full', stats });
  }

  // ── History helpers ──────────────────────────────────────────────────

  /** Handle the webview requesting history entries for the History tab. */
  private handleHistoryRequest(): void {
    const activeIds = new Set(this.sessionTracker.getState(null).sessions.map((s) => s.sessionId));
    const entries = this.sessionHistoryService.buildEntries(activeIds);
    this.postMessage({ type: 'history:full', entries });
  }

  /**
   * Handle the user clicking Resume on a history entry.
   *
   * If the session is already active in the dashboard, focuses it instead of
   * launching a duplicate. Otherwise, calls `sessionLauncher.resume()` with
   * the working directory from the history store.
   *
   * @param sessionId - The session ID to resume from history
   */
  private handleHistoryResume(sessionId: string): void {
    // Check if the session is already active in SessionTracker
    const state = this.sessionTracker.getState(null);
    const activeSession = state.sessions.find((s) => s.sessionId === sessionId);
    if (activeSession) {
      console.log(`${LOG_PREFIX.PANEL} History resume → session ${sessionId} is active, focusing`);
      this.focusSession(sessionId);
      return;
    }

    // Look up the stored CWD from the history store
    const historyEntry = this.sessionHistoryStore.get(sessionId);
    const cwd = historyEntry?.cwd;

    console.log(`${LOG_PREFIX.PANEL} History resume → launching session ${sessionId}`);
    this.sessionLauncher
      .resume(sessionId, '', cwd)
      .then(() => {
        // The resumed session shares the same sessionId, so register it
        this.conductorLaunchedIds.add(sessionId);
        this.pendingDiscoveryIds.add(sessionId);
        this.launchedSessionStore.save(sessionId, cwd).catch((err: unknown) => {
          console.log(`${LOG_PREFIX.PANEL} Failed to persist resumed session: ${err}`);
        });
        this.ptyBridge.registerSession(sessionId);
        this.postMessage({
          type: 'session:launch-status',
          sessionId,
          status: 'launched',
        });
        this.startLaunchDiscoveryPoll(sessionId);
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to resume session from history: ${err}`);
        this.postMessage({
          type: 'session:launch-status',
          status: 'error',
          error: String(err),
        });
      });
  }

  /**
   * Save initial history metadata for a newly launched/adopted session.
   * Uses workspace folder CWD as a best-effort value until the session's
   * actual CWD is known from JSONL records.
   *
   * @param sessionId - The session ID to save initial metadata for
   */
  private saveInitialHistoryMetadata(sessionId: string): void {
    const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this.sessionHistoryStore
      .save({
        sessionId,
        displayName: sessionId.slice(0, 8), // inline-ok: slug fallback until auto-name resolves
        cwd: workspaceCwd,
        filePath: '', // Will be updated when SessionTracker discovers the JSONL file
        savedAt: Date.now(),
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to save initial history metadata: ${err}`);
      });
  }

  /**
   * Update history store entries with the latest metadata from live sessions.
   * Only updates entries that already exist in the store (Conductor-launched sessions).
   *
   * @param sessions - Current live sessions from SessionTracker
   */
  private updateHistoryFromLiveSessions(sessions: SessionInfo[]): void {
    for (const session of sessions) {
      const existing = this.sessionHistoryStore.get(session.sessionId);
      if (!existing) continue;

      const displayName =
        session.customName || session.autoName || session.slug || existing.displayName;
      const needsUpdate =
        displayName !== existing.displayName ||
        (session.cwd && session.cwd !== existing.cwd) ||
        (session.filePath && session.filePath !== existing.filePath);

      if (needsUpdate) {
        this.sessionHistoryStore
          .update(session.sessionId, {
            displayName,
            ...(session.cwd ? { cwd: session.cwd } : {}),
            ...(session.filePath ? { filePath: session.filePath } : {}),
          })
          .catch((err: unknown) => {
            console.log(`${LOG_PREFIX.PANEL} Failed to update history metadata: ${err}`);
          });
      }
    }
  }

  private applyCustomNames(sessions: SessionInfo[]): SessionInfo[] {
    const registeredPtyIds = this.ptyBridge.getRegisteredSessionIds();
    return sessions.map((session) => {
      // Check primary ID first, then fall through to continuation member IDs
      let customName = this.nameStore.getName(session.sessionId);
      if (!customName && session.continuationSessionIds) {
        for (const memberId of session.continuationSessionIds) {
          customName = this.nameStore.getName(memberId);
          if (customName) break;
        }
      }

      let launchedByConductor =
        this.sessionLauncher.isLaunchedSession(session.sessionId) ||
        this.conductorLaunchedIds.has(session.sessionId);
      if (!launchedByConductor && session.continuationSessionIds) {
        launchedByConductor = session.continuationSessionIds.some(
          (id) => this.sessionLauncher.isLaunchedSession(id) || this.conductorLaunchedIds.has(id)
        );
      }
      const launchMode = this.launchedSessionModes.get(session.sessionId);

      let hasActivePty = registeredPtyIds.has(session.sessionId);
      if (!hasActivePty && session.continuationSessionIds) {
        hasActivePty = session.continuationSessionIds.some((id) => registeredPtyIds.has(id));
      }
      if (customName || launchedByConductor || launchMode || hasActivePty) {
        return {
          ...session,
          ...(customName ? { customName } : {}),
          ...(launchedByConductor ? { launchedByConductor: true } : {}),
          ...(launchMode ? { launchMode } : {}),
          ...(hasActivePty ? { hasActivePty: true } : {}),
        };
      }
      return session;
    });
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();

    const distUri = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src data:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>${PANEL_TITLE}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /** Dispose the panel, clear the singleton, and release all subscriptions. */
  dispose(): void {
    this.clearLaunchDiscoveryTimer();
    this.recentResumes.clear();
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.PANEL_FOCUSED, false);
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.KEYBOARD_NAV_ACTIVE, false);
    vscode.commands.executeCommand('setContext', CONTEXT_KEYS.TERMINAL_VIEW_SHOWING, false);
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
