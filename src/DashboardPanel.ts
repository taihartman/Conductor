import * as vscode from 'vscode';
import * as path from 'path';
import { SessionTracker } from './monitoring/SessionTracker';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './models/protocol';

export class DashboardPanel implements vscode.Disposable {
  public static currentPanel: DashboardPanel | undefined;
  private static readonly viewType = 'claudeAgentDashboard';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly sessionTracker: SessionTracker;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    sessionTracker: SessionTracker
  ): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Claude Agent Dashboard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist'),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(
      panel,
      context.extensionUri,
      sessionTracker
    );

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

  public postFullState(): void {
    const state = this.sessionTracker.getState();

    this.postMessage({ type: 'sessions:update', sessions: state.sessions });
    this.postMessage({ type: 'activity:full', events: state.activities });
    this.postMessage({ type: 'toolStats:update', stats: state.toolStats });
    this.postMessage({ type: 'tokens:update', tokenSummaries: state.tokenSummaries });
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  private handleMessage(message: WebviewToExtensionMessage): void {
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
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Claude Agent Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

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
