import * as vscode from 'vscode';
import { DashboardPanel } from './DashboardPanel';
import { SessionTracker } from './monitoring/SessionTracker';

let sessionTracker: SessionTracker | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('[ClaudeDashboard] Activating extension...');
  const outputChannel = vscode.window.createOutputChannel('Claude Agent Dashboard');
  context.subscriptions.push(outputChannel);

  sessionTracker = new SessionTracker(outputChannel);
  context.subscriptions.push(sessionTracker);

  const openCommand = vscode.commands.registerCommand('claudeAgentDashboard.open', () => {
    console.log('[ClaudeDashboard] Open command invoked');
    DashboardPanel.createOrShow(context, sessionTracker!);
  });

  const refreshCommand = vscode.commands.registerCommand('claudeAgentDashboard.refresh', () => {
    console.log('[ClaudeDashboard] Refresh command invoked');
    sessionTracker?.refresh();
    DashboardPanel.currentPanel?.postFullState();
  });

  context.subscriptions.push(openCommand, refreshCommand);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(pulse) Claude Agents';
  statusBarItem.tooltip = 'Open Claude Agent Dashboard';
  statusBarItem.command = 'claudeAgentDashboard.open';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  sessionTracker.start();
  outputChannel.appendLine('Claude Agent Dashboard activated');
  console.log('[ClaudeDashboard] Extension activated successfully');
}

export function deactivate(): void {
  console.log('[ClaudeDashboard] Deactivating extension');
  sessionTracker = undefined;
}
