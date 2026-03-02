import * as vscode from 'vscode';
import { DashboardPanel } from './DashboardPanel';
import { SessionTracker } from './monitoring/SessionTracker';
import { SessionNameStore } from './persistence/SessionNameStore';
import { SessionOrderStore } from './persistence/SessionOrderStore';
import { SessionVisibilityStore } from './persistence/SessionVisibilityStore';
import { SessionLauncher } from './terminal/SessionLauncher';
import { ProcessDiscovery } from './terminal/ProcessDiscovery';
import { PtyBridge } from './terminal/PtyBridge';
import { LaunchedSessionStore } from './persistence/LaunchedSessionStore';
import { SessionHistoryStore } from './persistence/SessionHistoryStore';
import { SessionHistoryService } from './persistence/SessionHistoryService';
import { StatsCacheReader } from './persistence/StatsCacheReader';
import { TileLayoutStore } from './persistence/TileLayoutStore';
import { AutoReconnectService } from './terminal/AutoReconnectService';
import { HookRegistrar } from './hooks/HookRegistrar';
import {
  OUTPUT_CHANNEL_NAME,
  STATUS_BAR_TEXT,
  STATUS_BAR_TOOLTIP,
  COMMANDS,
  LOG_PREFIX,
  SETTINGS,
  LAUNCH_MODES,
  TERMINAL_KEYS,
} from './constants';
import { quickPickSession } from './commands/quickPickSession';

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

  const processDiscovery = new ProcessDiscovery();
  const sessionLauncher = new SessionLauncher(outputChannel, processDiscovery);
  context.subscriptions.push(sessionLauncher);

  const ptyBridge = new PtyBridge();
  context.subscriptions.push(ptyBridge);

  const launchedSessionStore = new LaunchedSessionStore(context.workspaceState, outputChannel);
  context.subscriptions.push(launchedSessionStore);

  const sessionHistoryStore = new SessionHistoryStore(context.workspaceState, outputChannel);
  context.subscriptions.push(sessionHistoryStore);

  const sessionHistoryService = new SessionHistoryService(sessionHistoryStore, nameStore);
  const statsCacheReader = new StatsCacheReader(outputChannel);

  const tileLayoutStore = new TileLayoutStore(context.workspaceState, outputChannel);
  context.subscriptions.push(tileLayoutStore);

  const autoReconnect = new AutoReconnectService(
    sessionTracker,
    sessionLauncher,
    launchedSessionStore,
    ptyBridge,
    outputChannel
  );
  context.subscriptions.push(autoReconnect);

  const openCommand = vscode.commands.registerCommand(COMMANDS.OPEN, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Open command invoked`);
    DashboardPanel.createOrShow(
      context,
      sessionTracker!,
      nameStore,
      orderStore,
      visibilityStore,
      sessionLauncher,
      ptyBridge,
      launchedSessionStore,
      sessionHistoryStore,
      sessionHistoryService,
      statsCacheReader,
      tileLayoutStore
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
      .launch(undefined, LAUNCH_MODES.NORMAL)
      .then((sessionId) => {
        console.log(`${LOG_PREFIX.EXTENSION} Session launched: ${sessionId}`);
        // notifySessionLaunched() calls save() internally — no duplicate save here
        DashboardPanel.currentPanel?.notifySessionLaunched(
          sessionId,
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        );
      })
      .catch((err: unknown) => {
        console.log(`${LOG_PREFIX.EXTENSION} Failed to launch session: ${err}`);
        vscode.window.showErrorMessage(`Failed to launch Claude session: ${err}`);
      });
  });

  const quickPickCommand = vscode.commands.registerCommand(COMMANDS.QUICK_PICK_SESSION, () => {
    console.log(`${LOG_PREFIX.EXTENSION} Quick Pick session command invoked`);
    quickPickSession(context, sessionTracker!, nameStore, visibilityStore, {
      orderStore,
      sessionLauncher,
      ptyBridge,
      launchedSessionStore,
      sessionHistoryStore,
      sessionHistoryService,
      statsCacheReader,
      tileLayoutStore,
    }).catch((err: unknown) => {
      console.log(`${LOG_PREFIX.EXTENSION} Quick Pick failed: ${err}`);
    });
  });

  const navUpCommand = vscode.commands.registerCommand(COMMANDS.NAV_UP, () => {
    DashboardPanel.currentPanel?.navigate('up');
  });
  const navDownCommand = vscode.commands.registerCommand(COMMANDS.NAV_DOWN, () => {
    DashboardPanel.currentPanel?.navigate('down');
  });
  const navLeftCommand = vscode.commands.registerCommand(COMMANDS.NAV_LEFT, () => {
    DashboardPanel.currentPanel?.navigate('left');
  });
  const navRightCommand = vscode.commands.registerCommand(COMMANDS.NAV_RIGHT, () => {
    DashboardPanel.currentPanel?.navigate('right');
  });
  const navSelectCommand = vscode.commands.registerCommand(COMMANDS.NAV_SELECT, () => {
    DashboardPanel.currentPanel?.selectKeyboardFocused();
  });

  const termShiftEnter = vscode.commands.registerCommand(COMMANDS.TERMINAL_SHIFT_ENTER, () => {
    DashboardPanel.currentPanel?.injectTerminalKeys(TERMINAL_KEYS.SHIFT_ENTER);
  });
  const termCmdBackspace = vscode.commands.registerCommand(COMMANDS.TERMINAL_CMD_BACKSPACE, () => {
    DashboardPanel.currentPanel?.injectTerminalKeys(TERMINAL_KEYS.CMD_BACKSPACE);
  });

  context.subscriptions.push(
    openCommand,
    refreshCommand,
    launchCommand,
    quickPickCommand,
    navUpCommand,
    navDownCommand,
    navLeftCommand,
    navRightCommand,
    navSelectCommand,
    termShiftEnter,
    termCmdBackspace
  );

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = STATUS_BAR_TEXT;
  statusBarItem.tooltip = STATUS_BAR_TOOLTIP;
  statusBarItem.command = COMMANDS.OPEN;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Hook registration: auto-install Conductor hooks for real-time status detection.
  // Non-fatal: extension continues with JSONL-only detection if this fails.
  const hookRegistrar = new HookRegistrar();
  hookRegistrar
    .isInstalled()
    .then(async (installed) => {
      if (installed) {
        await hookRegistrar.ensureHookScript();
        console.log(`${LOG_PREFIX.EXTENSION} Conductor hooks already installed, script verified`);
      } else {
        await hookRegistrar.install();
        console.log(`${LOG_PREFIX.EXTENSION} Conductor hooks installed`);
        vscode.window.showInformationMessage(
          'Conductor hooks installed for real-time session status.'
        );
      }
    })
    .catch((err: unknown) => {
      console.log(`${LOG_PREFIX.EXTENSION} Hook setup failed (non-fatal): ${err}`);
      vscode.window.showWarningMessage(
        `Conductor hooks setup failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });

  sessionTracker.start();
  autoReconnect.start();

  autoReconnect.onSessionReconnected((sessionId) => {
    DashboardPanel.currentPanel?.notifySessionReconnected(sessionId);
  });

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SETTINGS.ADDITIONAL_WORKSPACES)) {
      sessionTracker?.updateScope();
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
