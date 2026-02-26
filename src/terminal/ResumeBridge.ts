import * as vscode from 'vscode';
import * as cp from 'child_process';
import { InputSendStatus } from '../models/protocol';
import { ITerminalBridge } from './ITerminalBridge';
import { LOG_PREFIX, SETTINGS, RESUME } from '../constants';

/**
 * Sends user input to Claude Code sessions via `claude --resume <id> --print`.
 *
 * @remarks
 * Unlike {@link TerminalBridge} which requires a visible VS Code terminal,
 * ResumeBridge spawns a CLI process that writes directly to the session's
 * JSONL file. This works across VS Code windows and doesn't require
 * terminal linking. SessionTracker picks up the response automatically.
 *
 * Uses `shell: false` with an args array to prevent command injection.
 * A per-session serial queue ensures messages arrive in order.
 */
export class ResumeBridge implements ITerminalBridge {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly queues = new Map<string, Promise<InputSendStatus>>();
  private disposed = false;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    console.log(`${LOG_PREFIX.RESUME_BRIDGE} Initialized`);
  }

  /**
   * Send user input to a session via `claude --resume --print`.
   * @param sessionId
   * @param text
   * @returns The send result status
   */
  async sendInput(sessionId: string, text: string): Promise<InputSendStatus> {
    if (this.disposed) {
      return 'error';
    }

    // Serial queue per session — concurrent sends to different sessions OK
    const prev = this.queues.get(sessionId) ?? Promise.resolve('sent' as InputSendStatus);
    const next = prev.then(() => this.doSend(sessionId, text));
    this.queues.set(sessionId, next);
    return next;
  }

  /**
   * Any session can be resumed — always return true.
   *
   * @param _sessionId - Unused; all sessions are resumable
   * @returns Always `true`
   */
  hasTerminal(_sessionId: string): boolean {
    return true;
  }

  private doSend(sessionId: string, text: string): Promise<InputSendStatus> {
    return new Promise((resolve) => {
      const launchCommand = vscode.workspace
        .getConfiguration()
        .get<string>(SETTINGS.LAUNCH_COMMAND, 'claude');

      // shell: false — text is a separate arg, no injection risk
      const child = cp.spawn(launchCommand, ['--resume', sessionId, '--print', text], {
        shell: false,
        stdio: 'ignore',
        env: { ...process.env, CLAUDECODE: '' },
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      });

      // Spawn succeeded — return 'sent' immediately (non-blocking)
      child.once('spawn', () => {
        console.log(`${LOG_PREFIX.RESUME_BRIDGE} Spawned --resume for ${sessionId}`);
        resolve('sent');
      });

      child.once('error', (err) => {
        console.log(`${LOG_PREFIX.RESUME_BRIDGE} Spawn error: ${err.message}`);
        this.outputChannel.appendLine(
          `${LOG_PREFIX.RESUME_BRIDGE} Failed to spawn claude: ${err.message}`
        );
        resolve('error');
      });

      // Safety timeout — kill the process if it hangs (doesn't affect the resolved promise)
      setTimeout(() => {
        if (!child.killed) {
          console.log(`${LOG_PREFIX.RESUME_BRIDGE} Timeout for ${sessionId}, killing process`);
          child.kill();
        }
      }, RESUME.TIMEOUT_MS);
    });
  }

  /** Mark as disposed and clear pending queues. */
  dispose(): void {
    this.disposed = true;
    this.queues.clear();
    console.log(`${LOG_PREFIX.RESUME_BRIDGE} Disposed`);
  }
}
