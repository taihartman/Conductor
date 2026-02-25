import * as vscode from 'vscode';
import { DashboardPanel } from './DashboardPanel';
import { SessionTracker } from './monitoring/SessionTracker';

let sessionTracker: SessionTracker | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Claude Agent Dashboard');
  context.subscriptions.push(outputChannel);

  sessionTracker = new SessionTracker(outputChannel);
  context.subscriptions.push(sessionTracker);

  const openCommand = vscode.commands.registerCommand(
    'claudeAgentDashboard.open',
    () => {
      DashboardPanel.createOrShow(context, sessionTracker!);
    }
  );

  const refreshCommand = vscode.commands.registerCommand(
    'claudeAgentDashboard.refresh',
    () => {
      sessionTracker?.refresh();
      DashboardPanel.currentPanel?.postFullState();
    }
  );

  context.subscriptions.push(openCommand, refreshCommand);

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(pulse) Claude Agents';
  statusBarItem.tooltip = 'Open Claude Agent Dashboard';
  statusBarItem.command = 'claudeAgentDashboard.open';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  sessionTracker.start();
  outputChannel.appendLine('Claude Agent Dashboard activated');
}

export function deactivate(): void {
  sessionTracker = undefined;
}
