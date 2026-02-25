import * as vscode from 'vscode';
import { DashboardPanel } from './DashboardPanel';
import { SessionTracker } from './monitoring/SessionTracker';

let sessionTracker: SessionTracker | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('[Conductor] Activating extension...');
  const outputChannel = vscode.window.createOutputChannel('Conductor');
  context.subscriptions.push(outputChannel);

  sessionTracker = new SessionTracker(outputChannel);
  context.subscriptions.push(sessionTracker);

  const openCommand = vscode.commands.registerCommand('conductor.open', () => {
    console.log('[Conductor] Open command invoked');
    DashboardPanel.createOrShow(context, sessionTracker!);
  });

  const refreshCommand = vscode.commands.registerCommand('conductor.refresh', () => {
    console.log('[Conductor] Refresh command invoked');
    sessionTracker?.refresh();
    DashboardPanel.currentPanel?.postFullState();
  });

  context.subscriptions.push(openCommand, refreshCommand);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(pulse) Conductor';
  statusBarItem.tooltip = 'Open Conductor';
  statusBarItem.command = 'conductor.open';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  sessionTracker.start();
  outputChannel.appendLine('Conductor activated');
  console.log('[Conductor] Extension activated successfully');
}

export function deactivate(): void {
  console.log('[Conductor] Deactivating extension');
  sessionTracker = undefined;
}
