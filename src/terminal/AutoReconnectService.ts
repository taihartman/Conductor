import * as vscode from 'vscode';
import { IAutoReconnectService } from './IAutoReconnectService';
import { ISessionLauncher } from './ISessionLauncher';
import { IPtyBridge } from './IPtyBridge';
import { ILaunchedSessionStore } from '../persistence/ILaunchedSessionStore';
import { SessionTracker } from '../monitoring/SessionTracker';
import { AUTO_RECONNECT, LOG_PREFIX, SESSION_STATUSES } from '../constants';
import { SessionStatus } from '../models/types';

/** Session statuses that indicate the session is alive and worth reconnecting.
 *  Includes `done` because after hook event replay on restart, `done` means
 *  "turn completed, process still running" (vs `idle` = "session ended"). */
const RECONNECTABLE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  SESSION_STATUSES.WORKING,
  SESSION_STATUSES.THINKING,
  SESSION_STATUSES.WAITING,
  SESSION_STATUSES.DONE,
]);

/**
 * Automatically reconnects terminals for Conductor-launched sessions
 * after extension reload or VS Code restart.
 *
 * @remarks
 * Subscribes to {@link SessionTracker.onStateChanged} events and waits until
 * all persisted sessions have completed their initial JSONL replay (so that
 * continuation grouping data is available). A settle timer gives the debounced
 * state and ContinuationGrouper time to stabilize before reconnection.
 * Falls back to a timeout if sessions never become ready.
 */
export class AutoReconnectService implements IAutoReconnectService {
  private readonly sessionTracker: SessionTracker;
  private readonly sessionLauncher: ISessionLauncher;
  private readonly launchedSessionStore: ILaunchedSessionStore;
  private readonly ptyBridge: IPtyBridge;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private attempted = false;

  private readonly _onSessionReconnected = new vscode.EventEmitter<string>();
  public readonly onSessionReconnected: vscode.Event<string> = this._onSessionReconnected.event;

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

    // Subscribe to all onStateChanged events and check readiness each time.
    // Only proceed once all persisted sessions have completed initial JSONL replay,
    // ensuring continuation grouping data is available for correct ID resolution.
    const stateDisposable = this.sessionTracker.onStateChanged(() => {
      if (this.attempted) return;

      if (!this.sessionTracker.areSessionsInitiallyProcessed(persistedIds)) {
        console.log(
          `${LOG_PREFIX.AUTO_RECONNECT} Sessions not yet ready, waiting for initial replay`
        );
        return;
      }

      // All persisted sessions are processed — dispose subscription, cancel fallback,
      // and start settle timer to let debounced state + grouper stabilize.
      stateDisposable.dispose();
      this.cancelFallbackTimer();

      console.log(
        `${LOG_PREFIX.AUTO_RECONNECT} All sessions initially processed, settling for ${AUTO_RECONNECT.READINESS_SETTLE_MS}ms`
      );

      this.settleTimer = setTimeout(() => {
        this.settleTimer = undefined;
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Settle timer fired, attempting reconnect`);
        this.attemptReconnect();
      }, AUTO_RECONNECT.READINESS_SETTLE_MS);
    });
    this.disposables.push(stateDisposable);

    // Fallback: if SessionTracker never fires (no JSONL files found) or
    // sessions never complete initial replay within the timeout window.
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

  private cancelSettleTimer(): void {
    if (this.settleTimer !== undefined) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
  }

  private attemptReconnect(): void {
    if (this.attempted) return;
    this.attempted = true;

    const persistedIds = this.launchedSessionStore.getAll();
    const sessions = this.sessionTracker.getState(null).sessions;
    const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

    const candidates: Array<{ sessionId: string; cwd?: string }> = [];
    const seenLatestIds = new Set<string>();

    for (const id of persistedIds) {
      // Skip if already has a terminal (e.g., extension hot-reloaded within same process)
      if (this.sessionLauncher.isLaunchedSession(id)) {
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — already launched`);
        continue;
      }

      // Resolve continuation chain: the persisted ID may be an older member
      const latestId = this.sessionTracker.getMostRecentContinuationMember(id);

      // Skip if the resolved ID already has a terminal
      if (this.sessionLauncher.isLaunchedSession(latestId)) {
        console.log(
          `${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — resolved ${latestId} already launched`
        );
        continue;
      }

      // Skip if another persisted ID already resolved to the same latestId
      if (seenLatestIds.has(latestId)) {
        console.log(
          `${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — duplicate resolved ID ${latestId}`
        );
        continue;
      }
      seenLatestIds.add(latestId);

      const session = sessionMap.get(latestId) ?? sessionMap.get(id);

      if (!session) {
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — not found in tracker`);
        continue;
      }

      if (!RECONNECTABLE_STATUSES.has(session.status)) {
        console.log(`${LOG_PREFIX.AUTO_RECONNECT} Skipping ${id} — status is ${session.status}`);
        continue;
      }

      // Prefer cwd from JSONL parsing; fall back to cwd persisted at launch time.
      // Uses original `id` (not `latestId`) for getCwd() since that's what was passed to save().
      const sessionCwd = session.cwd || this.launchedSessionStore.getCwd(id);
      candidates.push({ sessionId: latestId, cwd: sessionCwd });
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
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} Resumed session ${sessionId}`);
      this._onSessionReconnected.fire(sessionId);
    } catch (err) {
      console.log(`${LOG_PREFIX.AUTO_RECONNECT} Failed to resume ${sessionId}: ${err}`);
      throw err;
    }
  }

  /** Clean up timers and subscriptions. */
  dispose(): void {
    this.cancelFallbackTimer();
    this.cancelSettleTimer();
    this._onSessionReconnected.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
