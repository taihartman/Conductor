import * as vscode from 'vscode';
import { IAutoReconnectService } from './IAutoReconnectService';
import { ISessionLauncher } from './ISessionLauncher';
import { IPtyBridge } from './IPtyBridge';
import { ILaunchedSessionStore } from '../persistence/ILaunchedSessionStore';
import { SessionTracker } from '../monitoring/SessionTracker';
import { AUTO_RECONNECT, LOG_PREFIX, SESSION_STATUSES } from '../constants';
import { SessionStatus } from '../models/types';

/** Session statuses that indicate the session is alive and worth reconnecting. */
const RECONNECTABLE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  SESSION_STATUSES.WORKING,
  SESSION_STATUSES.THINKING,
  SESSION_STATUSES.WAITING,
]);

/**
 * Automatically reconnects terminals for Conductor-launched sessions
 * after extension reload or VS Code restart.
 *
 * @remarks
 * Listens for the first {@link SessionTracker.onStateChanged} event (indicating
 * initial JSONL discovery is complete) or a fallback timeout, then resumes
 * persisted sessions that are still alive.
 */
export class AutoReconnectService implements IAutoReconnectService {
  private readonly sessionTracker: SessionTracker;
  private readonly sessionLauncher: ISessionLauncher;
  private readonly launchedSessionStore: ILaunchedSessionStore;
  private readonly ptyBridge: IPtyBridge;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  private attempted = false;

  constructor(
    sessionTracker: SessionTracker,
    sessionLauncher: ISessionLauncher,
    launchedSessionStore: ILaunchedSessionStore,
    ptyBridge: IPtyBridge,
    outputChannel: vscode.OutputChannel
  ) {
    this.sessionTracker = sessionTracker;
    this.sessionLauncher = sessionLauncher;
    this.launchedSessionStore = launchedSessionStore;
    this.ptyBridge = ptyBridge;
    this.outputChannel = outputChannel;
  }

  /** Begin watching for initial session discovery, then auto-reconnect. */
  start(): void {
    const persistedIds = this.launchedSessionStore.getAll();
    if (persistedIds.length === 0) {
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} No persisted sessions, skipping`);
      return;
    }

    console.log(
      `${LOG_PREFIX.AUTO_RECONNECT} Waiting for session discovery (${persistedIds.length} persisted)`
    );

    // One-shot: first onStateChanged → attempt reconnect
    const stateDisposable = this.sessionTracker.onStateChanged(() => {
      stateDisposable.dispose();
      this.cancelFallbackTimer();
      this.attemptReconnect();
    });
    this.disposables.push(stateDisposable);

    // Fallback: if SessionTracker never fires (no JSONL files found)
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = undefined;
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} Fallback timeout reached`);
      this.attemptReconnect();
    }, AUTO_RECONNECT.FALLBACK_TIMEOUT_MS);
  }

  private cancelFallbackTimer(): void {
    if (this.fallbackTimer !== undefined) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = undefined;
    }
  }

  private attemptReconnect(): void {
    if (this.attempted) return;
    this.attempted = true;

    const persistedIds = this.launchedSessionStore.getAll();
    const sessions = this.sessionTracker.getState(null).sessions;
    const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

    const candidates: Array<{ sessionId: string; cwd?: string }> = [];

    for (const id of persistedIds) {
      // Skip if already has a terminal (e.g., extension hot-reloaded within same process)
      if (this.sessionLauncher.isLaunchedSession(id)) {
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — already launched`);
        continue;
      }

      // Resolve continuation chain: the persisted ID may be an older member
      const latestId = this.sessionTracker.getMostRecentContinuationMember(id);
      const session = sessionMap.get(latestId) ?? sessionMap.get(id);

      if (!session) {
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — not found in tracker`);
        continue;
      }

      if (!RECONNECTABLE_STATUSES.has(session.status)) {
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — status is ${session.status}`);
        continue;
      }

      candidates.push({ sessionId: latestId, cwd: session.cwd });
    }

    if (candidates.length === 0) {
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} No reconnectable sessions found`);
      return;
    }

    // Cap to avoid flooding
    const toReconnect = candidates.slice(0, AUTO_RECONNECT.MAX_SESSIONS);

    console.log(`${LOG_PREFIX.AUTO_RECONNECT} Reconnecting ${toReconnect.length} session(s)`);

    const promises = toReconnect.map(({ sessionId, cwd }) => this.resumeSession(sessionId, cwd));

    Promise.allSettled(promises).then((results) => {
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed === 0 && succeeded > 0) {
        vscode.window.showInformationMessage(
          `Conductor: Reconnected to ${succeeded} active session(s)`
        );
      } else if (failed > 0 && succeeded > 0) {
        vscode.window.showInformationMessage(
          `Conductor: Reconnected to ${succeeded} of ${succeeded + failed} session(s)`
        );
      }

      this.outputChannel.appendLine(
        `${LOG_PREFIX.AUTO_RECONNECT} Reconnect complete: ${succeeded} succeeded, ${failed} failed`
      );
    });
  }

  private async resumeSession(sessionId: string, cwd?: string): Promise<void> {
    try {
      await this.sessionLauncher.resume(sessionId, '', cwd);
      this.ptyBridge.registerSession(sessionId);
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} Resumed session ${sessionId}`);
    } catch (err) {
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} Failed to resume ${sessionId}: ${err}`);
      throw err;
    }
  }

  /** Clean up timers and subscriptions. */
  dispose(): void {
    this.cancelFallbackTimer();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
