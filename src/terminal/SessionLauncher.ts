/**
 * @module SessionLauncher
 *
 * Spawns Claude Code sessions from within Conductor using VS Code's native
 * terminal API (`shellPath` / `shellArgs`). This gives the spawned process a
 * **real PTY**, so Claude's interactive TUI renders properly.
 *
 * Pre-assigns a UUID session ID via `--session-id` so launch returns instantly
 * without polling for JSONL files.
 *
 * @remarks
 * **Trade-off:** Using `shellPath` instead of `child_process.spawn` + Pseudoterminal
 * means we don't have programmatic access to stdout/stderr. The `onPtyData` event
 * will not fire until a future migration to `node-pty`. The webview TerminalView
 * relies on `onPtyData` — it will remain blank for now. The VS Code terminal panel
 * works fully, and Claude creates JSONL files that SessionTracker discovers.
 */

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { ISessionLauncher } from './ISessionLauncher';
import { LOG_PREFIX, SETTINGS, PTY } from '../constants';

/** Internal state for a single launched session. */
interface LaunchedSession {
  sessionId: string;
  terminal: vscode.Terminal;
  closeListener: vscode.Disposable;
}

/**
 * Launches Claude Code sessions using VS Code's native terminal with a real PTY.
 *
 * @remarks
 * A UUID is pre-assigned via `--session-id` so launch returns immediately.
 * The terminal is created with `shellPath` / `shellArgs` — VS Code provides
 * the PTY, so Claude's TUI renders and the user can interact normally.
 */
export class SessionLauncher implements ISessionLauncher {
  private readonly sessions = new Map<string, LaunchedSession>();
  private readonly outputChannel: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly _onPtyData = new vscode.EventEmitter<{ sessionId: string; data: string }>();
  readonly onPtyData = this._onPtyData.event;

  private readonly _onSessionExit = new vscode.EventEmitter<{
    sessionId: string;
    code: number | null;
  }>();
  readonly onSessionExit = this._onSessionExit.event;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.disposables.push(this._onPtyData, this._onSessionExit);
    console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Initialized`);
  }

  /**
   * Launch a new Claude Code session in a real PTY terminal.
   * @param cwd
   * @returns The pre-assigned session UUID
   */
  async launch(cwd?: string): Promise<string> {
    let workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspacePath) {
      // No workspace open — prompt user to select a folder
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Launch Claude Here', // inline-ok: dialog-specific label
      });
      workspacePath = picked?.[0]?.fsPath;
      if (!workspacePath) {
        throw new Error('No folder selected — session launch cancelled');
      }
    }

    const launchCommand = vscode.workspace
      .getConfiguration()
      .get<string>(SETTINGS.LAUNCH_COMMAND, 'claude');

    const sessionId = randomUUID();

    console.log(
      `${LOG_PREFIX.SESSION_LAUNCHER} Launching "${launchCommand}" in ${workspacePath} (session: ${sessionId})`
    );
    this.outputChannel.appendLine(
      `${LOG_PREFIX.SESSION_LAUNCHER} Launching "${launchCommand}" in ${workspacePath}`
    );

    // Create VS Code terminal with real PTY via shellPath
    const terminal = vscode.window.createTerminal({
      name: PTY.TERMINAL_NAME,
      shellPath: launchCommand,
      shellArgs: ['--session-id', sessionId],
      cwd: workspacePath,
      env: { FORCE_COLOR: '1' },
    });
    terminal.show(false); // Show terminal panel without stealing editor focus

    console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Terminal created for session ${sessionId}`);
    this.outputChannel.appendLine(
      `${LOG_PREFIX.SESSION_LAUNCHER} Session ${sessionId} terminal created`
    );

    // Track terminal close → fire onSessionExit and clean up
    const closeListener = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal && this.sessions.has(sessionId)) {
        const code = t.exitStatus?.code ?? null;
        console.log(
          `${LOG_PREFIX.SESSION_LAUNCHER} Terminal closed for session ${sessionId} (code: ${code})`
        );
        this.outputChannel.appendLine(
          `${LOG_PREFIX.SESSION_LAUNCHER} Session ${sessionId} exited (code: ${code})`
        );
        this._onSessionExit.fire({ sessionId, code });
        const s = this.sessions.get(sessionId);
        s?.closeListener.dispose();
        this.sessions.delete(sessionId);
      }
    });

    const session: LaunchedSession = {
      sessionId,
      terminal,
      closeListener,
    };
    this.sessions.set(sessionId, session);

    return sessionId;
  }

  /**
   * Check if a session was launched by this instance.
   * @param sessionId
   * @returns `true` if the session is tracked
   */
  isLaunchedSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Send text to a launched session's terminal.
   * @param sessionId
   * @param data
   */
  writeInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} writeInput: no session ${sessionId}`);
      return;
    }
    session.terminal.sendText(data, false);
  }

  /**
   * Terminal resize is handled natively by VS Code when using `shellPath`.
   * This method is a no-op — it exists to fulfil the interface contract.
   *
   * @param sessionId - Target session ID
   * @param _cols - Unused; VS Code handles resize natively
   * @param _rows - Unused; VS Code handles resize natively
   */
  resize(sessionId: string, _cols: number, _rows: number): void {
    if (!this.sessions.has(sessionId)) {
      return;
    }
    // VS Code handles resize natively for shellPath terminals
  }

  /** Dispose all launched terminals and release event emitters. */
  dispose(): void {
    for (const [sessionId, session] of this.sessions) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Disposing session ${sessionId}`);
      session.terminal.dispose();
      session.closeListener.dispose();
    }
    this.sessions.clear();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
    console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Disposed`);
  }
}
