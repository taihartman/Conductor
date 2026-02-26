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
import { PANEL_TITLE, LOG_PREFIX, TIMING, PTY } from './constants';

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
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingAdoptions = new Set<string>();
  private focusedSessionId: string | null = null;
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
   * @returns The singleton DashboardPanel instance
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    sessionTracker: SessionTracker,
    nameStore: ISessionNameStore,
    orderStore: ISessionOrderStore,
    visibilityStore: ISessionVisibilityStore,
    sessionLauncher: ISessionLauncher,
    ptyBridge: IPtyBridge
  ): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (DashboardPanel.currentPanel) {
      console.log(`${LOG_PREFIX.PANEL} Revealing existing panel`);
      DashboardPanel.currentPanel.panel.reveal(column);
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
      ptyBridge
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
    ptyBridge: IPtyBridge
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionTracker = sessionTracker;
    this.nameStore = nameStore;
    this.orderStore = orderStore;
    this.visibilityStore = visibilityStore;
    this.sessionLauncher = sessionLauncher;
    this.ptyBridge = ptyBridge;

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
        this.postFullState();
      },
      null,
      this.disposables
    );

    this.visibilityStore.onVisibilityChanged(() => this.postFullState(), null, this.disposables);

    // Wire PTY data from SessionLauncher → PtyBridge ring buffer + webview
    this.sessionLauncher.onPtyData(
      ({ sessionId, data }) => {
        this.ptyBridge.pushData(sessionId, data);
        this.postMessage({ type: 'pty:data', sessionId, data });
      },
      null,
      this.disposables
    );

    // Clean up PtyBridge on session exit
    this.sessionLauncher.onSessionExit(
      ({ sessionId }) => {
        this.ptyBridge.unregisterSession(sessionId);
      },
      null,
      this.disposables
    );
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
    const visible = this.applyVisibility(named);
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
    });
  }

  /**
   * Notify the panel that a session was launched (from either the webview or command palette).
   * Posts launch-status to the webview and starts polling for the JSONL file.
   *
   * @param sessionId - The launched session's UUID
   */
  public notifySessionLaunched(sessionId: string): void {
    this.ptyBridge.registerSession(sessionId);
    this.postMessage({
      type: 'session:launch-status',
      sessionId,
      status: 'launched',
    });
    this.startLaunchDiscoveryPoll(sessionId);
  }

  private startLaunchDiscoveryPoll(sessionId: string): void {
    this.clearLaunchDiscoveryTimer();
    let retries = 0;
    this.launchDiscoveryTimer = setInterval(() => {
      this.sessionTracker.refresh();
      const found = this.sessionTracker
        .getState(null)
        .sessions.some((s) => s.sessionId === sessionId);
      if (found || ++retries >= TIMING.LAUNCH_DISCOVERY_MAX_RETRIES) {
        this.clearLaunchDiscoveryTimer();
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
    this.postMessage({ type: 'activity:full', events: activities });
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
    this.postMessage({ type: 'conversation:full', turns: conversation });
  }

  private handleMessage(message: WebviewToExtensionMessage): void {
    console.log(`${LOG_PREFIX.PANEL} Webview message received: ${message.type}`);
    switch (message.type) {
      case 'ready':
        this.postFullState();
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
        this.handleLaunch(message.cwd);
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
        this.sessionLauncher.writeInput(message.sessionId, message.data);
        break;
      case 'pty:resize':
        this.sessionLauncher.resize(message.sessionId, message.cols, message.rows);
        break;
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
    console.log(`${LOG_PREFIX.PANEL} Reordering sessions: ${sessionIds.length} session(s)`);
    this.orderStore.setOrder(sessionIds).catch((err: unknown) => {
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
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.PANEL} Failed to adopt session: ${err}`);
        this.postInputError(sessionId, err);
      });
  }

  private handleLaunch(cwd?: string): void {
    console.log(`${LOG_PREFIX.PANEL} Launching new session`);
    this.sessionLauncher
      .launch(cwd)
      .then((launchedId) => {
        console.log(`${LOG_PREFIX.PANEL} Session launched: ${launchedId}`);
        this.notifySessionLaunched(launchedId);
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
    if (target?.isArtifact) {
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

  /**
   * Pure sort: reorder sessions according to the cached order. No side effects.
   *
   * @param sessions - Sessions to sort
   * @param order - Ordered session IDs
   * @returns Sessions reordered by the given ID order
   */
  private sortByOrder(sessions: SessionInfo[], order: string[]): SessionInfo[] {
    const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));
    return order.filter((id) => sessionMap.has(id)).map((id) => sessionMap.get(id)!);
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
        hiddenIds.has(s.sessionId) || (s.isArtifact && !forceShownIds.has(s.sessionId));
      return hidden ? { ...s, isHidden: true } : s;
    });
  }

  /**
   * Adopt an external session by resuming it in a VS Code terminal.
   * Resolves continuation chains and guards against duplicate adoptions.
   *
   * @param sessionId - The session ID to adopt (resolved to most recent continuation member)
   * @param text - Message to deliver via `--print` (empty = adopt only)
   */
  private async adoptSession(sessionId: string, text: string): Promise<void> {
    const targetId = this.sessionTracker.getMostRecentContinuationMember(sessionId);
    const groupMembers = this.sessionTracker.getGroupMembers(sessionId);
    const primaryId = groupMembers[0]; // earliest member = primary

    if (this.pendingAdoptions.has(primaryId)) return;
    this.pendingAdoptions.add(primaryId);

    const state = this.sessionTracker.getState(null);
    const sessionCwd = state.sessions.find((s) => s.sessionId === targetId)?.cwd;

    try {
      await this.sessionLauncher.resume(targetId, text, sessionCwd);
      this.ptyBridge.registerSession(targetId);
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

  private applyCustomNames(sessions: SessionInfo[]): SessionInfo[] {
    return sessions.map((session) => {
      // Check primary ID first, then fall through to continuation member IDs
      let customName = this.nameStore.getName(session.sessionId);
      if (!customName && session.continuationSessionIds) {
        for (const memberId of session.continuationSessionIds) {
          customName = this.nameStore.getName(memberId);
          if (customName) break;
        }
      }

      const launchedByConductor = this.sessionLauncher.isLaunchedSession(session.sessionId);
      if (customName || launchedByConductor) {
        return {
          ...session,
          ...(customName ? { customName } : {}),
          ...(launchedByConductor ? { launchedByConductor: true } : {}),
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
