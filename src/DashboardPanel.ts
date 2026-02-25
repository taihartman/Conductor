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
  private readonly disposables: vscode.Disposable[] = [];

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
   * @returns The singleton DashboardPanel instance
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    sessionTracker: SessionTracker
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
    DashboardPanel.currentPanel = new DashboardPanel(panel, context.extensionUri, sessionTracker);

    return DashboardPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sessionTracker: SessionTracker
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionTracker = sessionTracker;

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.sessionTracker.onStateChanged(() => this.postFullState());
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
    const state = this.sessionTracker.getState();
    console.log(
      `${LOG_PREFIX.PANEL} Posting state → ${state.sessions.length} sessions, ${state.activities.length} activities, ${state.toolStats.length} tools, ${state.tokenSummaries.length} token summaries`
    );

    this.postMessage({ type: 'sessions:update', sessions: state.sessions });
    this.postMessage({ type: 'activity:full', events: state.activities });
    this.postMessage({ type: 'toolStats:update', stats: state.toolStats });
    this.postMessage({ type: 'tokens:update', tokenSummaries: state.tokenSummaries });
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  private handleMessage(message: WebviewToExtensionMessage): void {
    console.log(`${LOG_PREFIX.PANEL} Webview message received: ${message.type}`);
    switch (message.type) {
      case 'ready':
        this.postFullState();
        break;
      case 'session:focus':
        this.sessionTracker.focusSession(message.sessionId);
        break;
      case 'refresh':
        this.sessionTracker.refresh();
        this.postFullState();
        break;
    }
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
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
