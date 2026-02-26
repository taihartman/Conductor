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
import { ITerminalBridge } from './terminal/ITerminalBridge';
import { ISessionLauncher } from './terminal/ISessionLauncher';
import { IPtyBridge } from './terminal/IPtyBridge';
import { PANEL_TITLE, LOG_PREFIX } from './constants';

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
  private readonly terminalBridge: ITerminalBridge;
  private readonly sessionLauncher: ISessionLauncher;
  private readonly ptyBridge: IPtyBridge;
  private readonly disposables: vscode.Disposable[] = [];
  private focusedSessionId: string | null = null;
  private lastSessionIdSet: string = '';
  private cachedOrder: string[] = [];

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
   * @param terminalBridge - Bridge for sending user input to Claude Code terminals
   * @param sessionLauncher - Launches Claude Code sessions from within Conductor
   * @param ptyBridge - Relays PTY I/O for Conductor-launched sessions
   * @returns The singleton DashboardPanel instance
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    sessionTracker: SessionTracker,
    nameStore: ISessionNameStore,
    orderStore: ISessionOrderStore,
    terminalBridge: ITerminalBridge,
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
      terminalBridge,
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
    terminalBridge: ITerminalBridge,
    sessionLauncher: ISessionLauncher,
    ptyBridge: IPtyBridge
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionTracker = sessionTracker;
    this.nameStore = nameStore;
    this.orderStore = orderStore;
    this.terminalBridge = terminalBridge;
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
    const sessions = this.applyCustomOrder(named);
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
      case 'session:rename': {
        console.log(
          `${LOG_PREFIX.PANEL} Renaming session ${message.sessionId} → "${message.name}"`
        );
        // Store under the primary ID (which is the sessionId of merged sessions).
        // Clear stale custom names on non-primary member IDs to prevent ghost resurfaces.
        const renamePromises: Promise<void>[] = [
          this.nameStore.setName(message.sessionId, message.name),
        ];
        const state = this.sessionTracker.getState(this.focusedSessionId);
        const targetSession = state.sessions.find((s) => s.sessionId === message.sessionId);
        if (targetSession?.continuationSessionIds) {
          for (const memberId of targetSession.continuationSessionIds) {
            if (memberId !== message.sessionId && this.nameStore.getName(memberId)) {
              renamePromises.push(this.nameStore.setName(memberId, ''));
            }
          }
        }
        Promise.all(renamePromises).catch((err: unknown) => {
          console.log(`${LOG_PREFIX.PANEL} Failed to rename session: ${err}`);
          this.postFullState();
        });
        break;
      }
      case 'session:reorder':
        console.log(
          `${LOG_PREFIX.PANEL} Reordering sessions: ${message.sessionIds.length} session(s)`
        );
        this.orderStore.setOrder(message.sessionIds).catch((err: unknown) => {
          console.log(`${LOG_PREFIX.PANEL} Failed to persist session order: ${err}`);
        });
        break;
      case 'user:send-input': {
        // For merged sessions, route to the most recent continuation member's terminal
        const targetId = this.sessionTracker.getMostRecentContinuationMember(message.sessionId);

        // Route through PtyBridge for Conductor-launched sessions, TerminalBridge otherwise
        if (this.sessionLauncher.isLaunchedSession(targetId)) {
          this.sessionLauncher.writeInput(targetId, message.text + '\n');
          this.postMessage({
            type: 'user:input-status',
            sessionId: message.sessionId, // original merged ID, NOT targetId
            status: 'sent',
          });
        } else {
          this.terminalBridge
            .sendInput(targetId, message.text)
            .then((status) => {
              this.postMessage({
                type: 'user:input-status',
                sessionId: message.sessionId, // original merged ID, NOT targetId
                status,
              });
            })
            .catch((err: unknown) => {
              console.log(`${LOG_PREFIX.PANEL} Failed to send input: ${err}`);
              this.postMessage({
                type: 'user:input-status',
                sessionId: message.sessionId,
                status: 'error',
                error: String(err),
              });
            });
        }
        break;
      }
      case 'session:launch': {
        console.log(`${LOG_PREFIX.PANEL} Launching new session`);
        this.sessionLauncher
          .launch(message.cwd)
          .then((sessionId) => {
            console.log(`${LOG_PREFIX.PANEL} Session launched: ${sessionId}`);
            this.ptyBridge.registerSession(sessionId);
            this.postMessage({
              type: 'session:launch-status',
              sessionId,
              status: 'launched',
            });
          })
          .catch((err: unknown) => {
            console.log(`${LOG_PREFIX.PANEL} Failed to launch session: ${err}`);
            this.postMessage({
              type: 'session:launch-status',
              status: 'error',
              error: String(err),
            });
          });
        break;
      }
      case 'pty:input': {
        this.sessionLauncher.writeInput(message.sessionId, message.data);
        break;
      }
      case 'pty:resize': {
        this.sessionLauncher.resize(message.sessionId, message.cols, message.rows);
        break;
      }
    }
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
