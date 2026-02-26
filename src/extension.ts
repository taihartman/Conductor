import * as vscode from 'vscode';
import { DashboardPanel } from './DashboardPanel';
import { SessionTracker } from './monitoring/SessionTracker';
import { SessionNameStore } from './persistence/SessionNameStore';
import { SessionOrderStore } from './persistence/SessionOrderStore';
import { SessionVisibilityStore } from './persistence/SessionVisibilityStore';
import { SessionLauncher } from './terminal/SessionLauncher';
import { PtyBridge } from './terminal/PtyBridge';
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

  const orderStore = new SessionOrderStore(context.workspaceState, outputChannel);
  context.subscriptions.push(orderStore);

  const visibilityStore = new SessionVisibilityStore(context.workspaceState, outputChannel);
  context.subscriptions.push(visibilityStore);

  const sessionLauncher = new SessionLauncher(outputChannel);
  context.subscriptions.push(sessionLauncher);

  const ptyBridge = new PtyBridge();
  context.subscriptions.push(ptyBridge);

  const openCommand = vscode.commands.registerCommand(COMMANDS.OPEN, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Open command invoked`);
    DashboardPanel.createOrShow(
      context,
      sessionTracker!,
      nameStore,
      orderStore,
      visibilityStore,
      sessionLauncher,
      ptyBridge
    );
  });

  const refreshCommand = vscode.commands.registerCommand(COMMANDS.REFRESH, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Refresh command invoked`);
    sessionTracker?.refresh();
    DashboardPanel.currentPanel?.postFullState();
  });

  const launchCommand = vscode.commands.registerCommand(COMMANDS.LAUNCH_SESSION, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Launch session command invoked`);
    sessionLauncher
      .launch()
      .then((sessionId) => {
        console.log(`${LOG_PREFIX.EXTENSION} Session launched: ${sessionId}`);
        // Delegate to DashboardPanel if open — it handles PtyBridge, status, and polling
        DashboardPanel.currentPanel?.notifySessionLaunched(sessionId);
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.EXTENSION} Failed to launch session: ${err}`);
        vscode.window.showErrorMessage(`Failed to launch Claude session: ${err}`);
      });
  });

  context.subscriptions.push(openCommand, refreshCommand, launchCommand);

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
