import * as vscode from 'vscode';
import { DashboardPanel } from './DashboardPanel';
import { SessionTracker } from './monitoring/SessionTracker';
import { SessionNameStore } from './persistence/SessionNameStore';
import {
  OUTPUT_CHANNEL_NAME,
  STATUS_BAR_TEXT,
  STATUS_BAR_TOOLTIP,
  COMMANDS,
  LOG_PREFIX,
  SETTINGS,
} from './constants';

let sessionTracker: SessionTracker | undefined;

/**
 * Activate the Conductor extension.
 *
 * @param context - VS Code extension context for registering commands and disposables
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log(`${LOG_PREFIX.EXTENSION} Activating extension...`);
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(outputChannel);

  // Multi-root workspaces: only the first folder is used for scoping
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  sessionTracker = new SessionTracker(outputChannel, workspacePath);
  context.subscriptions.push(sessionTracker);

  const nameStore = new SessionNameStore(context.globalState, outputChannel);
  context.subscriptions.push(nameStore);

  const openCommand = vscode.commands.registerCommand(COMMANDS.OPEN, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Open command invoked`);
    DashboardPanel.createOrShow(context, sessionTracker!, nameStore);
  });

  const refreshCommand = vscode.commands.registerCommand(COMMANDS.REFRESH, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Refresh command invoked`);
    sessionTracker?.refresh();
    DashboardPanel.currentPanel?.postFullState();
  });

  context.subscriptions.push(openCommand, refreshCommand);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = STATUS_BAR_TEXT;
  statusBarItem.tooltip = STATUS_BAR_TOOLTIP;
  statusBarItem.command = COMMANDS.OPEN;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  sessionTracker.start();

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SETTINGS.ADDITIONAL_WORKSPACES)) {
      sessionTracker?.updateScope(workspacePath);
    }
  });
  context.subscriptions.push(configWatcher);

  outputChannel.appendLine(`${OUTPUT_CHANNEL_NAME} activated`);
  console.log(`${LOG_PREFIX.EXTENSION} Extension activated successfully`);
}

/** Deactivate the Conductor extension and release resources. */
export function deactivate(): void {
  console.log(`${LOG_PREFIX.EXTENSION} Deactivating extension`);
  sessionTracker = undefined;
}
