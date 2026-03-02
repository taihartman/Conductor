import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTO_RECONNECT } from '../constants';

// --- Mock vscode ---
const { mockShowInformationMessage, MockEmitter } = vi.hoisted(() => {
  class _MockEmitter {
    private listeners: Function[] = [];
    event = (listener: Function) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter((l) => l !== listener);
        },
      };
    };
    fire(data?: any) {
      [...this.listeners].forEach((l) => l(data));
    }
    dispose() {
      this.listeners = [];
    }
  }
  return {
    mockShowInformationMessage: vi.fn(),
    MockEmitter: _MockEmitter,
  };
});

vi.mock('vscode', () => ({
  EventEmitter: MockEmitter,
  window: {
    showInformationMessage: mockShowInformationMessage,
  },
}));

import { AutoReconnectService } from '../terminal/AutoReconnectService';

// --- Mock factories ---

function createMockSessionTracker(): any {
  const emitter = new MockEmitter();
  return {
    onStateChanged: emitter.event,
    _fireStateChanged: () => emitter.fire(),
    getState: vi.fn(() => ({
      sessions: [],
      activities: [],
      conversation: [],
      toolStats: [],
      tokenSummaries: [],
    })),
    getMostRecentContinuationMember: vi.fn((id: string) => id),
    getGroupMembers: vi.fn((id: string) => [id]),
    areSessionsInitiallyProcessed: vi.fn(() => true),
    dispose: vi.fn(),
  };
}

function createMockSessionLauncher(): any {
  return {
    isLaunchedSession: vi.fn(() => false),
    resume: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
}

function createMockLaunchedSessionStore(): any {
  const sessions = new Map<string, { timestamp: number; cwd?: string }>();
  return {
    getAll: vi.fn(() => Array.from(sessions.keys())),
    save: vi.fn(async (id: string, cwd?: string) => {
      const existing = sessions.get(id);
      sessions.set(id, { timestamp: Date.now(), cwd: cwd ?? existing?.cwd });
    }),
    remove: vi.fn(async (id: string) => sessions.delete(id)),
    getCwd: vi.fn((id: string) => sessions.get(id)?.cwd),
    prune: vi.fn(async () => {}),
    dispose: vi.fn(),
    _set: (id: string, cwd?: string) => sessions.set(id, { timestamp: Date.now(), cwd }),
  };
}

function createMockPtyBridge(): any {
  return {
    registerSession: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockOutputChannel(): any {
  return { appendLine: vi.fn() };
}

function createSession(id: string, status: string, cwd = '/workspace'): any {
  return {
    sessionId: id,
    status,
    cwd,
    slug: id.slice(0, 8),
    summary: '',
    model: 'claude-sonnet-4-6',
    gitBranch: '',
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    turnCount: 1,
    toolCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    isArtifact: false,
    filePath: `/tmp/${id}.jsonl`,
  };
}

/** Fire onStateChanged and advance past the settle timer so attemptReconnect() runs. */
async function fireAndSettle(tracker: any): Promise<void> {
  tracker._fireStateChanged();
  vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
  await vi.runAllTimersAsync();
}

describe('AutoReconnectService', () => {
  let tracker: ReturnType<typeof createMockSessionTracker>;
  let launcher: ReturnType<typeof createMockSessionLauncher>;
  let launchedStore: ReturnType<typeof createMockLaunchedSessionStore>;
  let ptyBridge: ReturnType<typeof createMockPtyBridge>;
  let outputChannel: ReturnType<typeof createMockOutputChannel>;
  let service: AutoReconnectService;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = createMockSessionTracker();
    launcher = createMockSessionLauncher();
    launchedStore = createMockLaunchedSessionStore();
    ptyBridge = createMockPtyBridge();
    outputChannel = createMockOutputChannel();
    mockShowInformationMessage.mockClear();

    service = new AutoReconnectService(tracker, launcher, launchedStore, ptyBridge, outputChannel);
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it('reconnects sessions with active status (working/thinking/waiting)', async () => {
    launchedStore._set('s1');
    launchedStore._set('s2');
    launchedStore._set('s3');
    tracker.getState.mockReturnValue({
      sessions: [
        createSession('s1', 'working'),
        createSession('s2', 'thinking'),
        createSession('s3', 'waiting'),
      ],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledTimes(3);
    // PtyBridge registration is handled by preSpawnCallback, not by AutoReconnectService
    expect(ptyBridge.registerSession).not.toHaveBeenCalled();
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Conductor: Reconnected to 3 active session(s)'
    );
  });

  it('skips sessions already tracked by SessionLauncher', async () => {
    launchedStore._set('s1');
    launcher.isLaunchedSession.mockImplementation((id: string) => id === 's1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('reconnects sessions in done status', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'done')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledWith('s1', '', '/workspace');
  });

  it('skips sessions with idle status', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'idle')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('skips sessions not found in SessionTracker', async () => {
    launchedStore._set('orphan-id');
    tracker.getState.mockReturnValue({ sessions: [] });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('caps at MAX_SESSIONS', async () => {
    for (let i = 0; i < 8; i++) {
      launchedStore._set(`s${i}`);
    }
    tracker.getState.mockReturnValue({
      sessions: Array.from({ length: 8 }, (_, i) => createSession(`s${i}`, 'working')),
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledTimes(AUTO_RECONNECT.MAX_SESSIONS);
  });

  it('individual resume failure does not block others (Promise.allSettled)', async () => {
    launchedStore._set('s1');
    launchedStore._set('s2');
    launchedStore._set('s3');
    tracker.getState.mockReturnValue({
      sessions: [
        createSession('s1', 'working'),
        createSession('s2', 'working'),
        createSession('s3', 'working'),
      ],
    });
    launcher.resume.mockImplementation((id: string) => {
      if (id === 's2') return Promise.reject(new Error('process not found'));
      return Promise.resolve();
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledTimes(3);
    // PtyBridge registration is handled by preSpawnCallback, not by AutoReconnectService
    expect(ptyBridge.registerSession).not.toHaveBeenCalled();
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Conductor: Reconnected to 2 of 3 session(s)'
    );
  });

  it('fires after readiness + settle on first ready onStateChanged event', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    service.start();

    // First fire triggers readiness check → settle → reconnect
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledTimes(1);

    // Second fire should be ignored (attempted flag)
    launcher.resume.mockClear();
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('fires on fallback timeout if onStateChanged never fires', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    service.start();

    // Advance past fallback timeout
    vi.advanceTimersByTime(AUTO_RECONNECT.FALLBACK_TIMEOUT_MS);
    await vi.runAllTimersAsync();

    expect(launcher.resume).toHaveBeenCalledTimes(1);
  });

  it('does not attempt reconnect if no persisted sessions', () => {
    service.start();

    // Should not subscribe to state changes when there are no persisted sessions
    tracker._fireStateChanged();

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('disposes cleanly (cancels timers, removes listeners)', () => {
    launchedStore._set('s1');

    service.start();
    service.dispose();

    // After dispose, neither event nor timeout should trigger reconnect
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.FALLBACK_TIMEOUT_MS);

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('resolves continuation chains during reconnect', async () => {
    launchedStore._set('old-id');
    tracker.getMostRecentContinuationMember.mockReturnValue('new-id');
    tracker.getState.mockReturnValue({
      sessions: [createSession('new-id', 'working')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledWith('new-id', '', '/workspace');
  });

  it('skips when resolved latestId is already launched', async () => {
    launchedStore._set('old-id');
    tracker.getMostRecentContinuationMember.mockReturnValue('new-id');
    // old-id is not launched, but new-id (resolved) is
    launcher.isLaunchedSession.mockImplementation((id: string) => id === 'new-id');
    tracker.getState.mockReturnValue({
      sessions: [createSession('new-id', 'working')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('deduplicates when two persisted IDs resolve to the same latestId', async () => {
    launchedStore._set('old-a');
    launchedStore._set('old-b');
    // Both resolve to the same continuation member
    tracker.getMostRecentContinuationMember.mockReturnValue('shared-latest');
    tracker.getState.mockReturnValue({
      sessions: [createSession('shared-latest', 'working')],
    });

    service.start();
    await fireAndSettle(tracker);

    // Should only resume once, not twice
    expect(launcher.resume).toHaveBeenCalledTimes(1);
    expect(launcher.resume).toHaveBeenCalledWith('shared-latest', '', '/workspace');
  });

  it('uses stored cwd from LaunchedSessionStore when session.cwd is empty', async () => {
    launchedStore._set('s1', '/stored/project');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working', '')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launchedStore.getCwd).toHaveBeenCalledWith('s1');
    expect(launcher.resume).toHaveBeenCalledWith('s1', '', '/stored/project');
  });

  it('prefers session.cwd from SessionTracker when populated', async () => {
    launchedStore._set('s1', '/stored/project');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working', '/tracker/project')],
    });

    service.start();
    await fireAndSettle(tracker);

    expect(launcher.resume).toHaveBeenCalledWith('s1', '', '/tracker/project');
  });

  // --- Readiness gate tests ---

  it('waits for readiness before attempting reconnect', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    // Initially not ready
    tracker.areSessionsInitiallyProcessed.mockReturnValue(false);

    service.start();

    // First event: not ready yet — should not reconnect (only advance settle, not fallback)
    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    expect(launcher.resume).not.toHaveBeenCalled();

    // Second event: still not ready
    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    expect(launcher.resume).not.toHaveBeenCalled();

    // Now become ready
    tracker.areSessionsInitiallyProcessed.mockReturnValue(true);

    // Third event: ready → settle → reconnect
    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(launcher.resume).toHaveBeenCalledTimes(1);
    expect(launcher.resume).toHaveBeenCalledWith('s1', '', '/workspace');
  });

  it('falls back on timeout when sessions never become ready', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    // Never ready
    tracker.areSessionsInitiallyProcessed.mockReturnValue(false);

    service.start();

    // Fire some events — all ignored because not ready
    tracker._fireStateChanged();
    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    expect(launcher.resume).not.toHaveBeenCalled();

    // Advance past fallback timeout
    vi.advanceTimersByTime(AUTO_RECONNECT.FALLBACK_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(launcher.resume).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect if disposed during settle period', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    service.start();

    // Fire event → readiness detected → settle timer starts
    tracker._fireStateChanged();

    // Dispose before settle timer fires
    service.dispose();

    // Advance past settle period
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    await vi.runAllTimersAsync();

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('handles mixed tracked/untracked persisted IDs correctly', async () => {
    launchedStore._set('tracked-s1');
    launchedStore._set('unknown-s2');

    // Only tracked-s1 is in the tracker; unknown-s2 is never discovered.
    // areSessionsInitiallyProcessed returns false initially (tracked-s1 not processed),
    // then true after tracked-s1 is processed (unknown-s2 treated as ready).
    let callCount = 0;
    tracker.areSessionsInitiallyProcessed.mockImplementation(() => {
      callCount++;
      return callCount > 1; // false on first call, true on second+
    });

    tracker.getState.mockReturnValue({
      sessions: [createSession('tracked-s1', 'working')],
    });

    service.start();

    // First event: not ready (tracked-s1 not processed yet)
    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    expect(launcher.resume).not.toHaveBeenCalled();

    // Second event: ready (tracked-s1 processed, unknown-s2 treated as ready)
    tracker._fireStateChanged();
    vi.advanceTimersByTime(AUTO_RECONNECT.READINESS_SETTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    // Only tracked-s1 is reconnectable (unknown-s2 is not in the session map)
    expect(launcher.resume).toHaveBeenCalledTimes(1);
    expect(launcher.resume).toHaveBeenCalledWith('tracked-s1', '', '/workspace');
  });

  describe('onSessionReconnected event', () => {
    it('fires with sessionId after successful resume', async () => {
      launchedStore._set('s1');
      tracker.getState.mockReturnValue({
        sessions: [createSession('s1', 'working')],
      });

      const reconnectedIds: string[] = [];
      service.onSessionReconnected((id) => reconnectedIds.push(id));

      service.start();
      await fireAndSettle(tracker);

      expect(reconnectedIds).toEqual(['s1']);
    });

    it('does not fire for failed resume', async () => {
      launchedStore._set('s1');
      tracker.getState.mockReturnValue({
        sessions: [createSession('s1', 'working')],
      });
      launcher.resume.mockRejectedValue(new Error('process not found'));

      const reconnectedIds: string[] = [];
      service.onSessionReconnected((id) => reconnectedIds.push(id));

      service.start();
      await fireAndSettle(tracker);

      expect(reconnectedIds).toEqual([]);
    });

    it('fires for each successfully reconnected session', async () => {
      launchedStore._set('s1');
      launchedStore._set('s2');
      launchedStore._set('s3');
      tracker.getState.mockReturnValue({
        sessions: [
          createSession('s1', 'working'),
          createSession('s2', 'working'),
          createSession('s3', 'working'),
        ],
      });
      launcher.resume.mockImplementation((id: string) => {
        if (id === 's2') return Promise.reject(new Error('fail'));
        return Promise.resolve();
      });

      const reconnectedIds: string[] = [];
      service.onSessionReconnected((id) => reconnectedIds.push(id));

      service.start();
      await fireAndSettle(tracker);

      expect(reconnectedIds).toContain('s1');
      expect(reconnectedIds).toContain('s3');
      expect(reconnectedIds).not.toContain('s2');
    });
  });
});
