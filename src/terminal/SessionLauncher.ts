/**
 * @module SessionLauncher
 *
 * Spawns Claude Code sessions using node-pty for full PTY output capture.
 * Falls back to VS Code's native `shellPath` terminal when node-pty is
 * unavailable (ABI mismatch, missing binary, unsupported platform).
 *
 * Pre-assigns a UUID session ID via `--session-id` so launch returns instantly
 * without polling for JSONL files.
 *
 * @remarks
 * **Data flow (node-pty mode):**
 * ```
 * node-pty.spawn() → onData → _onPtyData.fire() → DashboardPanel → webview xterm.js
 *                   → ConductorPseudoterminal.write() → VS Code terminal panel
 * stdin: webview(pty:input) or VS Code(handleInput) → ptyProcess.write()
 * resize: webview(pty:resize) or VS Code(setDimensions) → ptyProcess.resize()
 * ```
 *
 * **Fallback (shellPath mode):**
 * Extension remains functional — only the webview terminal view is unavailable.
 * The VS Code terminal panel works fully, and Claude creates JSONL files that
 * SessionTracker discovers.
 */

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ISessionLauncher } from './ISessionLauncher';
import { IProcessDiscovery } from './IProcessDiscovery';
import { ConductorPseudoterminal } from './ConductorPseudoterminal';
import {
  LOG_PREFIX,
  SETTINGS,
  PTY,
  CLAUDE_ENV,
  ERROR_MESSAGES,
  TIMING,
  CLAUDE_CLI,
  LAUNCH_MODES,
} from '../constants';
import type { LaunchMode } from '../constants';

/**
 * Returns true if the extension host is running inside a Claude Code session.
 * @returns Whether the CLAUDECODE env var is set
 */
export function isInsideClaudeSession(): boolean {
  return !!process.env[CLAUDE_ENV.ACTIVE];
}

/** node-pty module type — loaded dynamically to support graceful fallback. */
type NodePtyModule = typeof import('node-pty');

/** Internal state for a single launched session. */
interface LaunchedSession {
  sessionId: string;
  ptyProcess: import('node-pty').IPty | null;
  pseudoTerminal: ConductorPseudoterminal | null;
  terminal: vscode.Terminal;
  closeListener: vscode.Disposable;
}

/**
 * Launches Claude Code sessions with node-pty for full PTY capture,
 * falling back to VS Code's native shellPath terminal when unavailable.
 *
 * @remarks
 * A UUID is pre-assigned via `--session-id` so launch returns immediately.
 * When node-pty is available, output is routed to both the webview terminal
 * (via `_onPtyData`) and the VS Code terminal panel (via ConductorPseudoterminal).
 */
export class SessionLauncher implements ISessionLauncher {
  private readonly sessions = new Map<string, LaunchedSession>();
  private readonly outputChannel: vscode.OutputChannel;
  private readonly processDiscovery?: IProcessDiscovery;
  private readonly disposables: vscode.Disposable[] = [];

  /** Cached node-pty module — `null` means fallback to shellPath. */
  private nodePtyModule: NodePtyModule | null | undefined = undefined;

  /** Optional callback invoked before pty.spawn() to register PtyBridge. */
  private preSpawnCallback?: (sessionId: string) => void;

  private readonly _onPtyData = new vscode.EventEmitter<{ sessionId: string; data: string }>();
  readonly onPtyData = this._onPtyData.event;

  private readonly _onSessionExit = new vscode.EventEmitter<{
    sessionId: string;
    code: number | null;
  }>();
  readonly onSessionExit = this._onSessionExit.event;

  constructor(outputChannel: vscode.OutputChannel, processDiscovery?: IProcessDiscovery) {
    this.outputChannel = outputChannel;
    this.processDiscovery = processDiscovery;
    this.disposables.push(this._onPtyData, this._onSessionExit);
    console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Initialized`);
  }

  /**
   * Set a callback that fires before pty.spawn() to allow pre-registration
   * (e.g. PtyBridge.registerSession) before data starts flowing.
   * @param cb - Callback receiving the session ID before spawn
   */
  setPreSpawnCallback(cb: (sessionId: string) => void): void {
    this.preSpawnCallback = cb;
  }

  /**
   * Launch a new Claude Code session.
   * @param cwd - Working directory (defaults to workspace root, prompts if none)
   * @param mode - Launch mode: normal, yolo, or remote (defaults to normal)
   * @returns The pre-assigned session UUID
   */
  async launch(cwd?: string, mode?: LaunchMode): Promise<string> {
    const launchMode = mode ?? LAUNCH_MODES.NORMAL;

    if (launchMode === LAUNCH_MODES.REMOTE) {
      throw new Error('Remote mode is not yet supported');
    }

    if (isInsideClaudeSession()) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Blocked: nested Claude Code session detected`);
      this.outputChannel.appendLine(
        `${LOG_PREFIX.SESSION_LAUNCHER} ${ERROR_MESSAGES.NESTED_SESSION}`
      );
      throw new Error(ERROR_MESSAGES.NESTED_SESSION);
    }

    let workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspacePath) {
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

    const sessionId = randomUUID();
    const args = ['--session-id', sessionId];
    if (launchMode === LAUNCH_MODES.YOLO) {
      args.push(CLAUDE_CLI.DANGEROUSLY_SKIP_PERMISSIONS);
    }

    console.log(
      `${LOG_PREFIX.SESSION_LAUNCHER} Launching in ${workspacePath} (session: ${sessionId}, mode: ${launchMode})`
    );
    this.outputChannel.appendLine(`${LOG_PREFIX.SESSION_LAUNCHER} Launching in ${workspacePath}`);

    await this.spawnSession(sessionId, args, PTY.TERMINAL_NAME, workspacePath);

    return sessionId;
  }

  /**
   * Adopt an external session by opening a terminal with `claude --resume`.
   * When `text` is non-empty the message is delivered atomically via `--print`.
   * @param sessionId - The session ID to resume
   * @param text - Optional message to deliver via --print
   * @param cwd - Working directory (defaults to workspace root)
   */
  async resume(sessionId: string, text: string, cwd?: string): Promise<void> {
    if (isInsideClaudeSession()) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Blocked: nested Claude Code session detected`);
      this.outputChannel.appendLine(
        `${LOG_PREFIX.SESSION_LAUNCHER} ${ERROR_MESSAGES.NESTED_SESSION}`
      );
      throw new Error(ERROR_MESSAGES.NESTED_SESSION);
    }

    let workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspacePath) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Resume Claude Here', // inline-ok: dialog-specific label
      });
      workspacePath = picked?.[0]?.fsPath;
      if (!workspacePath) {
        throw new Error('No folder selected — session resume cancelled');
      }
    }

    console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Resuming session ${sessionId} in ${workspacePath}`);
    this.outputChannel.appendLine(
      `${LOG_PREFIX.SESSION_LAUNCHER} Resuming session ${sessionId} in ${workspacePath}`
    );

    const shellArgs = ['--resume', sessionId];
    if (text) {
      shellArgs.push('--print', text);
    }

    await this.spawnSession(sessionId, shellArgs, PTY.RESUMED_TERMINAL_NAME, workspacePath);
  }

  /**
   * Transfer a running session from an external terminal into Conductor's PTY.
   * When searchIds is provided, tries each ID in order against ProcessDiscovery.
   * Resumes with the ID that was actually found in the terminal (not necessarily sessionId).
   * Falls back to resume(sessionId) if no owning terminal is found.
   *
   * @param sessionId - Default session ID (used for resume fallback)
   * @param text - Optional message to deliver on resume
   * @param cwd - Working directory for the new terminal
   * @param searchIds - Optional list of IDs to search for (e.g., continuation group members)
   * @returns The session ID that was actually resumed
   */
  async transfer(
    sessionId: string,
    text: string,
    cwd?: string,
    searchIds?: readonly string[]
  ): Promise<string> {
    if (isInsideClaudeSession()) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Blocked: nested Claude Code session detected`);
      this.outputChannel.appendLine(
        `${LOG_PREFIX.SESSION_LAUNCHER} ${ERROR_MESSAGES.NESTED_SESSION}`
      );
      throw new Error(ERROR_MESSAGES.NESTED_SESSION);
    }

    if (!this.processDiscovery) {
      console.log(
        `${LOG_PREFIX.SESSION_LAUNCHER} No process discovery available, falling back to resume`
      );
      await this.resume(sessionId, text, cwd);
      return sessionId;
    }

    // Search for the session — try all provided IDs or just sessionId
    const idsToSearch = searchIds ?? [sessionId];
    let owner: import('./IProcessDiscovery').ProcessOwnerResult = {};
    let resumeWithId = sessionId;

    for (const id of idsToSearch) {
      owner = await this.processDiscovery.findSessionOwner(id, cwd);
      if (owner.terminal) {
        resumeWithId = id;
        console.log(
          `${LOG_PREFIX.SESSION_LAUNCHER} Matched group member ${id} → terminal "${owner.terminal.name}"`
        );
        break;
      }
    }

    if (!owner.terminal) {
      console.log(
        `${LOG_PREFIX.SESSION_LAUNCHER} No owning terminal found for ${sessionId}, falling back to resume`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.SESSION_LAUNCHER} No owning terminal found, resuming ${sessionId} directly`
      );
      await this.resume(sessionId, text, cwd);
      return sessionId;
    }

    console.log(
      `${LOG_PREFIX.SESSION_LAUNCHER} Transferring session ${resumeWithId}: closing terminal "${owner.terminal.name}"` +
        (owner.claudePid ? ` (claude pid: ${owner.claudePid})` : '')
    );
    this.outputChannel.appendLine(
      `${LOG_PREFIX.SESSION_LAUNCHER} Transferring session ${resumeWithId}: closing external terminal`
    );

    owner.terminal.dispose();
    await delay(TIMING.TRANSFER_SETTLE_MS);

    try {
      await this.resume(resumeWithId, text, cwd);
    } catch (err) {
      console.log(
        `${LOG_PREFIX.SESSION_LAUNCHER} Resume failed after terminal close for ${resumeWithId}: ${err}`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.SESSION_LAUNCHER} Transfer recovery: resume failed for session ${resumeWithId}. ` +
          `Try running: claude --resume ${resumeWithId}`
      );
      throw err;
    }

    return resumeWithId;
  }

  /**
   * Check if a session was launched by this instance.
   * @param sessionId - The session ID to check
   * @returns Whether the session exists in the launched sessions map
   */
  isLaunchedSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Send raw input data to a launched session's stdin.
   * @param sessionId - Target session
   * @param data - Raw data to write
   */
  writeInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} writeInput: no session ${sessionId}`);
      return;
    }
    if (session.ptyProcess) {
      session.ptyProcess.write(data);
    } else {
      session.terminal.sendText(data, false);
    }
  }

  /**
   * Notify a launched session of a terminal resize.
   * @param sessionId - Target session
   * @param cols - New column count
   * @param rows - New row count
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session?.ptyProcess) {
      return;
    }
    session.ptyProcess.resize(cols, rows);
  }

  /** Dispose all launched terminals and release event emitters. */
  dispose(): void {
    for (const [sessionId, session] of this.sessions) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Disposing session ${sessionId}`);
      if (session.ptyProcess) {
        try {
          session.ptyProcess.kill();
        } catch {
          // Process may already be dead
        }
      }
      session.pseudoTerminal?.dispose();
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

  // ── Private ────────────────────────────────────────────────────────────

  /**
   * Attempt to dynamically import node-pty. Returns null on failure (cached).
   *
   * On macOS, node-pty uses a `spawn-helper` binary via `posix_spawn()`.
   * npm sometimes installs this binary without the execute bit, causing
   * `posix_spawnp failed` at runtime. We detect and fix this automatically.
   *
   * @returns The node-pty module, or null if unavailable
   */
  private async loadNodePty(): Promise<NodePtyModule | null> {
    if (this.nodePtyModule !== undefined) {
      return this.nodePtyModule;
    }
    try {
      this.nodePtyModule = await import('node-pty');
      this.ensureSpawnHelperExecutable();
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} node-pty loaded successfully`);
      this.outputChannel.appendLine(`${LOG_PREFIX.SESSION_LAUNCHER} node-pty loaded`);
      return this.nodePtyModule;
    } catch (err) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} node-pty unavailable, falling back to shellPath`);
      this.outputChannel.appendLine(`${LOG_PREFIX.SESSION_LAUNCHER} node-pty load failed: ${err}`);
      this.nodePtyModule = null;
      return null;
    }
  }

  /**
   * Ensure node-pty's spawn-helper binary is executable.
   *
   * On macOS, node-pty delegates process spawning to a compiled helper binary
   * via `posix_spawn()`. npm occasionally strips the execute permission during
   * install, which causes every `pty.spawn()` call to fail with
   * `posix_spawnp failed` (EACCES). This method detects and fixes the issue.
   */
  private ensureSpawnHelperExecutable(): void {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return;
    }
    try {
      const nodePtyDir = path.dirname(require.resolve('node-pty/package.json'));
      const helperPath = path.join(
        nodePtyDir,
        'prebuilds',
        `${process.platform}-${process.arch}`,
        'spawn-helper'
      );

      const stat = fs.statSync(helperPath);
      const OWNER_EXECUTE = 0o100; // inline-ok: unix permission bit
      if (!(stat.mode & OWNER_EXECUTE)) {
        fs.chmodSync(helperPath, 0o755); // inline-ok: standard executable permission
        console.log(
          `${LOG_PREFIX.SESSION_LAUNCHER} Fixed spawn-helper permissions at ${helperPath}`
        );
        this.outputChannel.appendLine(
          `${LOG_PREFIX.SESSION_LAUNCHER} Fixed spawn-helper permissions (was not executable)`
        );
      }
    } catch {
      // Non-critical — if the helper doesn't exist at this path,
      // node-pty may use a different resolution strategy
    }
  }

  /**
   * Spawn a session using node-pty (preferred) or shellPath (fallback).
   *
   * @param sessionId - Pre-assigned session UUID
   * @param args - CLI arguments for the claude command
   * @param terminalName - Display name for the VS Code terminal tab
   * @param cwd - Working directory (may be undefined)
   */
  private async spawnSession(
    sessionId: string,
    args: string[],
    terminalName: string,
    cwd: string | undefined
  ): Promise<void> {
    const launchCommand = vscode.workspace
      .getConfiguration()
      .get<string>(SETTINGS.LAUNCH_COMMAND, 'claude');

    const nodePty = await this.loadNodePty();

    if (nodePty) {
      this.spawnWithNodePty(nodePty, sessionId, launchCommand, args, terminalName, cwd);
    } else {
      this.spawnWithShellPath(sessionId, launchCommand, args, terminalName, cwd);
    }
  }

  /**
   * Spawn using node-pty with full output capture.
   * @param nodePty - The loaded node-pty module
   * @param sessionId - Pre-assigned session UUID
   * @param command - CLI command to execute
   * @param args - CLI arguments
   * @param terminalName - Display name for the VS Code terminal tab
   * @param cwd - Working directory
   */
  private spawnWithNodePty(
    nodePty: NodePtyModule,
    sessionId: string,
    command: string,
    args: string[],
    terminalName: string,
    cwd: string | undefined
  ): void {
    // Register PtyBridge BEFORE spawn to prevent data loss race condition
    this.preSpawnCallback?.(sessionId);

    let ptyProcess: import('node-pty').IPty;
    try {
      ptyProcess = nodePty.spawn(command, args, {
        name: PTY.TERM_ENV,
        cols: PTY.DEFAULT_COLS,
        rows: PTY.DEFAULT_ROWS,
        cwd: cwd || process.cwd(),
        env: buildCleanEnv(),
      });
    } catch (err) {
      console.log(`${LOG_PREFIX.SESSION_LAUNCHER} pty.spawn() failed: ${err}`);
      this.outputChannel.appendLine(`${LOG_PREFIX.SESSION_LAUNCHER} pty.spawn() failed: ${err}`);
      this._onSessionExit.fire({ sessionId, code: null });
      throw err;
    }

    console.log(
      `${LOG_PREFIX.SESSION_LAUNCHER} node-pty spawned for session ${sessionId} (pid: ${ptyProcess.pid})`
    );
    this.outputChannel.appendLine(
      `${LOG_PREFIX.SESSION_LAUNCHER} Session ${sessionId} spawned (pid: ${ptyProcess.pid})`
    );

    // Create Pseudoterminal for the VS Code terminal panel
    const pseudoTerminal = new ConductorPseudoterminal({
      onInput: (data): void => ptyProcess.write(data),
      onResize: (cols, rows): void => {
        try {
          ptyProcess.resize(cols, rows);
        } catch {
          // Process may already be dead
        }
      },
      onClose: (): void => {
        try {
          ptyProcess.kill();
        } catch {
          // Process may already be dead
        }
      },
    });

    // Wire pty output → pseudoTerminal (VS Code panel) + onPtyData (webview)
    ptyProcess.onData((data) => {
      pseudoTerminal.write(data);
      this._onPtyData.fire({ sessionId, data });
    });

    // Wire pty exit → cleanup
    ptyProcess.onExit(({ exitCode }) => {
      console.log(
        `${LOG_PREFIX.SESSION_LAUNCHER} PTY exited for session ${sessionId} (code: ${exitCode})`
      );
      this.outputChannel.appendLine(
        `${LOG_PREFIX.SESSION_LAUNCHER} Session ${sessionId} exited (code: ${exitCode})`
      );
      pseudoTerminal.exit(exitCode);
      this._onSessionExit.fire({ sessionId, code: exitCode });
      const s = this.sessions.get(sessionId);
      s?.closeListener.dispose();
      this.sessions.delete(sessionId);
    });

    // Create VS Code terminal to host the pseudoterminal (hidden — webview xterm.js is primary)
    const terminal = vscode.window.createTerminal({ name: terminalName, pty: pseudoTerminal });

    // Track terminal close (user closes tab) → kill pty
    const closeListener = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal && this.sessions.has(sessionId)) {
        console.log(`${LOG_PREFIX.SESSION_LAUNCHER} Terminal tab closed for session ${sessionId}`);
        try {
          ptyProcess.kill();
        } catch {
          // Process may already be dead — onExit will handle cleanup
        }
      }
    });

    const session: LaunchedSession = {
      sessionId,
      ptyProcess,
      pseudoTerminal,
      terminal,
      closeListener,
    };
    this.sessions.set(sessionId, session);
  }

  /**
   * Fallback: spawn using VS Code's native shellPath terminal (no output capture).
   * @param sessionId - Pre-assigned session UUID
   * @param command - CLI command to execute
   * @param args - CLI arguments
   * @param terminalName - Display name for the VS Code terminal tab
   * @param cwd - Working directory
   */
  private spawnWithShellPath(
    sessionId: string,
    command: string,
    args: string[],
    terminalName: string,
    cwd: string | undefined
  ): void {
    console.log(
      `${LOG_PREFIX.SESSION_LAUNCHER} Falling back to shellPath for session ${sessionId}`
    );

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      shellPath: command,
      shellArgs: args,
      ...(cwd ? { cwd } : {}),
      env: {
        FORCE_COLOR: '1',
        [CLAUDE_ENV.ACTIVE]: '',
        [CLAUDE_ENV.SSE_PORT]: '',
        [CLAUDE_ENV.ENTRYPOINT]: '',
      },
    });
    terminal.show(false);

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
      ptyProcess: null,
      pseudoTerminal: null,
      terminal,
      closeListener,
    };
    this.sessions.set(sessionId, session);
  }
}

/**
 * Build a clean env for spawned Claude processes.
 * Removes Conductor/Claude env vars that would cause the child to think
 * it's inside an existing Claude session (nested session guard).
 * @returns Clean environment variables record
 */
function buildCleanEnv(): Record<string, string> {
  const env = { ...process.env, FORCE_COLOR: '1' } as Record<string, string>;
  delete env[CLAUDE_ENV.ACTIVE];
  delete env[CLAUDE_ENV.SSE_PORT];
  delete env[CLAUDE_ENV.ENTRYPOINT];
  return env;
}

/**
 * Promise-based delay for transfer settle time.
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
