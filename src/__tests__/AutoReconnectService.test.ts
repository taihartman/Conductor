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
  const sessions = new Map<string, number>();
  return {
    getAll: vi.fn(() => Array.from(sessions.keys())),
    save: vi.fn(async (id: string) => sessions.set(id, Date.now())),
    remove: vi.fn(async (id: string) => sessions.delete(id)),
    prune: vi.fn(async () => {}),
    dispose: vi.fn(),
    _set: (id: string) => sessions.set(id, Date.now()),
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
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: false,
    isArtifact: false,
    filePath: `/tmp/${id}.jsonl`,
  };
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
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

    expect(launcher.resume).toHaveBeenCalledTimes(3);
    expect(ptyBridge.registerSession).toHaveBeenCalledTimes(3);
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
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('skips sessions with inactive status (done/idle)', async () => {
    launchedStore._set('s1');
    launchedStore._set('s2');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'done'), createSession('s2', 'idle')],
    });

    service.start();
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

    expect(launcher.resume).not.toHaveBeenCalled();
  });

  it('skips sessions not found in SessionTracker', async () => {
    launchedStore._set('orphan-id');
    tracker.getState.mockReturnValue({ sessions: [] });

    service.start();
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

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
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

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
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

    expect(launcher.resume).toHaveBeenCalledTimes(3);
    // s1 and s3 should have registered, s2 should not (it threw)
    expect(ptyBridge.registerSession).toHaveBeenCalledWith('s1');
    expect(ptyBridge.registerSession).not.toHaveBeenCalledWith('s2');
    expect(ptyBridge.registerSession).toHaveBeenCalledWith('s3');
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Conductor: Reconnected to 2 of 3 session(s)'
    );
  });

  it('fires on first onStateChanged event', async () => {
    launchedStore._set('s1');
    tracker.getState.mockReturnValue({
      sessions: [createSession('s1', 'working')],
    });

    service.start();

    // First fire triggers reconnect
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

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
    tracker._fireStateChanged();
    await vi.runAllTimersAsync();

    expect(launcher.resume).toHaveBeenCalledWith('new-id', '', '/workspace');
  });
});
