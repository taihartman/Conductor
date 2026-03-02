import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PTY, LAUNCH_MODES, TIMING, WORKSPACE_STATE_KEYS } from '../constants';
import type { LaunchMode } from '../constants';

// --- Mock vscode ---
let messageHandler: ((msg: any) => void) | undefined;
let viewStateHandler: ((e: any) => void) | undefined;
const postedMessages: any[] = [];

const mockConfigValues: Record<string, unknown> = {};
const mockConfigUpdate = vi.fn(() => Promise.resolve());

/** In-memory mock for vscode.Memento (workspaceState / globalState). */
const mockWorkspaceStateStore: Record<string, unknown> = {};
function createMockMemento(): any {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      return key in mockWorkspaceStateStore ? mockWorkspaceStateStore[key] : defaultValue;
    }),
    update: vi.fn((key: string, value: unknown) => {
      mockWorkspaceStateStore[key] = value;
      return Promise.resolve();
    }),
    keys: vi.fn(() => Object.keys(mockWorkspaceStateStore)),
  };
}

vi.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
    joinPath: (base: any, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      scheme: 'file',
      path: [base.path, ...segments].join('/'),
    }),
  },
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: '',
        asWebviewUri: (uri: any) => uri,
        cspSource: 'mock-csp',
        postMessage: vi.fn((msg: any) => {
          postedMessages.push(msg);
        }),
        onDidReceiveMessage: vi.fn((handler: (msg: any) => void) => {
          messageHandler = handler;
          return { dispose: vi.fn() };
        }),
      },
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeViewState: vi.fn((handler: (e: any) => void) => {
        viewStateHandler = handler;
        return { dispose: vi.fn() };
      }),
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
    activeTextEditor: undefined,
  },
  commands: {
    executeCommand: vi.fn(),
  },
  ViewColumn: { One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  EventEmitter: class MockEmitter {
    private listeners: Function[] = [];
    event = (listener: Function) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data: any) {
      this.listeners.forEach((l) => l(data));
    }
    dispose() {
      this.listeners = [];
    }
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        return key in mockConfigValues ? mockConfigValues[key] : defaultValue;
      }),
      update: mockConfigUpdate,
    })),
  },
}));

import { DashboardPanel } from '../DashboardPanel';

// --- Mock factories ---

function createMockSessionTracker(): any {
  return {
    onStateChanged: vi.fn(() => ({ dispose: vi.fn() })),
    getState: vi.fn(() => ({
      sessions: [],
      activities: [],
      conversation: [],
      toolStats: [],
      tokenSummaries: [],
    })),
    getFilteredActivities: vi.fn(() => []),
    getFilteredConversation: vi.fn(() => []),
    getContinuationMemberIds: vi.fn(() => new Set<string>()),
    getMostRecentContinuationMember: vi.fn((id: string) => id),
    getGroupMembers: vi.fn((id: string) => [id]),
    refresh: vi.fn(),
    getMonitoringScope: vi.fn().mockReturnValue('~/.claude/projects/'),
  };
}

function createMockNameStore(): any {
  return {
    onNamesChanged: vi.fn(() => ({ dispose: vi.fn() })),
    getName: vi.fn(() => undefined),
    setName: vi.fn(() => Promise.resolve()),
  };
}

function createMockOrderStore(): any {
  let order: string[] = [];
  return {
    onOrderChanged: vi.fn(() => ({ dispose: vi.fn() })),
    getOrder: vi.fn(() => order),
    setOrder: vi.fn((newOrder: string[]) => {
      order = newOrder;
      return Promise.resolve();
    }),
    /** Test helper: set internal order without going through setOrder mock */
    _setOrderDirect(newOrder: string[]): void {
      order = newOrder;
    },
  };
}

function createMockVisibilityStore(): any {
  return {
    onVisibilityChanged: vi.fn(() => ({ dispose: vi.fn() })),
    getHiddenIds: vi.fn(() => new Set<string>()),
    getForceShownIds: vi.fn(() => new Set<string>()),
    pruneStaleIds: vi.fn(() => Promise.resolve(false)),
    hideSession: vi.fn(() => Promise.resolve()),
    unhideSession: vi.fn(() => Promise.resolve()),
    forceShowSession: vi.fn(() => Promise.resolve()),
    unforceShowSession: vi.fn(() => Promise.resolve()),
  };
}

function createMockSessionLauncher(): any {
  return {
    onPtyData: vi.fn(() => ({ dispose: vi.fn() })),
    onSessionExit: vi.fn(() => ({ dispose: vi.fn() })),
    isLaunchedSession: vi.fn(() => false),
    writeInput: vi.fn(),
    resize: vi.fn(),
    launch: vi.fn(() => Promise.resolve('new-session-id')),
    resume: vi.fn(() => Promise.resolve()),
    transfer: vi.fn((...args: any[]) => Promise.resolve(args[0] as string)),
    setPreSpawnCallback: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockPtyBridge(): any {
  const buffers = new Map<string, string>();
  return {
    registerSession: vi.fn((id: string) => {
      if (!buffers.has(id)) buffers.set(id, '');
    }),
    unregisterSession: vi.fn((id: string) => {
      buffers.delete(id);
    }),
    pushData: vi.fn((id: string, data: string) => {
      buffers.set(id, (buffers.get(id) ?? '') + data);
    }),
    getBufferedData: vi.fn((id: string) => buffers.get(id) ?? ''),
    getRegisteredSessionIds: vi.fn(() => new Set(buffers.keys())),
    hasSession: vi.fn((id: string) => buffers.has(id)),
  };
}

function createMockLaunchedSessionStore(): any {
  return {
    getAll: vi.fn(() => []),
    save: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    getCwd: vi.fn(() => undefined),
    prune: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
}

function createMockSessionHistoryStore(): any {
  return {
    save: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    getAll: vi.fn(() => []),
    get: vi.fn(() => undefined),
    remove: vi.fn(() => Promise.resolve()),
    prune: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
}

function createMockSessionHistoryService(): any {
  return {
    buildEntries: vi.fn(() => []),
  };
}

function createMockStatsCacheReader(): any {
  return {
    read: vi.fn(() => Promise.resolve(null)),
  };
}

function createMockTileLayoutStore(): any {
  return {
    getLayouts: vi.fn(() => []),
    setLayouts: vi.fn(() => Promise.resolve()),
    onLayoutsChanged: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}

function createMockContext(): any {
  return {
    extensionUri: { fsPath: '/ext', scheme: 'file', path: '/ext' },
    workspaceState: createMockMemento(),
  };
}

/** Send a message to the panel as if the webview posted it. */
function sendMessage(msg: any): void {
  if (!messageHandler) throw new Error('No message handler registered');
  messageHandler(msg);
}

/** Find the most recent posted message of a given type. */
function lastPosted(type: string): any {
  return [...postedMessages].reverse().find((m) => m.type === type);
}

describe('DashboardPanel message routing', () => {
  let tracker: ReturnType<typeof createMockSessionTracker>;
  let launcher: ReturnType<typeof createMockSessionLauncher>;
  let ptyBridge: ReturnType<typeof createMockPtyBridge>;

  beforeEach(() => {
    // Reset singleton
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;

    postedMessages.length = 0;
    messageHandler = undefined;
    viewStateHandler = undefined;

    // Reset workspace state store between tests
    for (const key of Object.keys(mockWorkspaceStateStore)) {
      delete mockWorkspaceStateStore[key];
    }

    tracker = createMockSessionTracker();
    launcher = createMockSessionLauncher();
    ptyBridge = createMockPtyBridge();

    DashboardPanel.createOrShow(
      createMockContext(),
      tracker,
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      launcher,
      ptyBridge,
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    // Clear the initial state:full post from createOrShow
    postedMessages.length = 0;
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  describe('user:send-input — Path A (direct write)', () => {
    it('writes to terminal when targetId is a launched session', () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('session-abc');
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'session-abc');

      sendMessage({ type: 'user:send-input', sessionId: 'session-abc', text: 'hello' });

      expect(launcher.writeInput).toHaveBeenCalledWith('session-abc', `hello${PTY.INPUT_SUBMIT}`);
      const status = lastPosted('user:input-status');
      expect(status).toEqual({
        type: 'user:input-status',
        sessionId: 'session-abc',
        status: 'sent',
      });
    });
  });

  describe('user:send-input — Path B (group member fallback)', () => {
    it('writes to launched group member when targetId has no terminal', () => {
      // Target is cont-2 (most recent), but cont-1 has the terminal
      tracker.getMostRecentContinuationMember.mockReturnValue('cont-2');
      tracker.getGroupMembers.mockReturnValue(['cont-1', 'cont-2']);
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'cont-1');

      sendMessage({ type: 'user:send-input', sessionId: 'merged-id', text: 'hello' });

      expect(launcher.writeInput).toHaveBeenCalledWith('cont-1', `hello${PTY.INPUT_SUBMIT}`);
      const status = lastPosted('user:input-status');
      expect(status.status).toBe('sent');
    });
  });

  describe('user:send-input — Path C (adoption)', () => {
    it('posts adopting then sent on successful adoption', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.isLaunchedSession.mockReturnValue(false);

      launcher.transfer.mockResolvedValue('ext-session');

      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'hi' });

      // Should have posted 'adopting' immediately
      const adopting = postedMessages.find(
        (m) => m.type === 'user:input-status' && m.status === 'adopting'
      );
      expect(adopting).toBeDefined();
      expect(adopting.sessionId).toBe('ext-session');

      // Flush microtask queue for .then()
      await vi.waitFor(() => {
        const sent = postedMessages.find(
          (m) => m.type === 'user:input-status' && m.status === 'sent'
        );
        expect(sent).toBeDefined();
      });

      // transfer receives all group members as 4th arg
      expect(launcher.transfer).toHaveBeenCalledWith('ext-session', 'hi', undefined, [
        'ext-session',
      ]);
      // PtyBridge registration is handled by preSpawnCallback, not adoptSession
      expect(ptyBridge.registerSession).not.toHaveBeenCalledWith('ext-session');
    });

    it('posts error on adoption failure', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.isLaunchedSession.mockReturnValue(false);

      launcher.transfer.mockRejectedValue(new Error('spawn failed'));

      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'hi' });

      await vi.waitFor(() => {
        const error = postedMessages.find(
          (m) => m.type === 'user:input-status' && m.status === 'error'
        );
        expect(error).toBeDefined();
        expect(error.error).toContain('spawn failed');
      });
    });

    it('deduplicates concurrent adoptions on same primary ID', () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.isLaunchedSession.mockReturnValue(false);

      // Never-resolving promise to keep adoption in-flight
      launcher.transfer.mockReturnValue(new Promise(() => {}));

      // First send — triggers adoption
      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'first' });
      expect(launcher.transfer).toHaveBeenCalledTimes(1);

      // Second send — same session, should be deduped
      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'second' });
      expect(launcher.transfer).toHaveBeenCalledTimes(1); // NOT 2

      const sentMessages = postedMessages.filter(
        (m) => m.type === 'user:input-status' && m.status === 'sent'
      );
      expect(sentMessages).toHaveLength(1); // dedup guard posts 'sent' for second msg
    });
  });

  describe('session:adopt', () => {
    it('posts adopted status on success', async () => {
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.transfer.mockResolvedValue('ext-session');

      sendMessage({ type: 'session:adopt', sessionId: 'ext-session' });

      await vi.waitFor(() => {
        const adopted = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'adopted'
        );
        expect(adopted).toBeDefined();
        expect(adopted.sessionId).toBe('ext-session');
      });

      // transfer receives all group members as 4th arg
      expect(launcher.transfer).toHaveBeenCalledWith('ext-session', '', undefined, ['ext-session']);
      // PtyBridge registration is handled by preSpawnCallback, not adoptSession
      expect(ptyBridge.registerSession).not.toHaveBeenCalledWith('ext-session');
    });

    it('posts error status on failure', async () => {
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.transfer.mockRejectedValue(new Error('no claude'));

      sendMessage({ type: 'session:adopt', sessionId: 'ext-session' });

      await vi.waitFor(() => {
        const error = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'error'
        );
        expect(error).toBeDefined();
        expect(error.error).toContain('no claude');
      });
    });

    it('passes all continuation group members and uses returned ID for registration', async () => {
      // Group has [A, B, C], transfer finds terminal on B and returns B
      tracker.getGroupMembers.mockReturnValue(['member-a', 'member-b', 'member-c']);
      launcher.transfer.mockResolvedValue('member-b');

      sendMessage({ type: 'session:adopt', sessionId: 'member-a' });

      await vi.waitFor(() => {
        const adopted = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'adopted'
        );
        expect(adopted).toBeDefined();
      });

      // Should pass all group members as searchIds
      expect(launcher.transfer).toHaveBeenCalledWith('member-a', '', undefined, [
        'member-a',
        'member-b',
        'member-c',
      ]);
    });

    it('skips adoption when a group member already has a launched terminal', async () => {
      tracker.getGroupMembers.mockReturnValue(['member-a', 'member-b']);
      // member-b is already launched by Conductor (e.g. AutoReconnectService resumed it)
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'member-b');

      sendMessage({ type: 'session:adopt', sessionId: 'member-a' });

      // Allow microtasks to settle
      await vi.waitFor(() => {
        // transfer() should never be called because the guard returns early
        expect(launcher.transfer).not.toHaveBeenCalled();
      });
    });
  });

  describe('PTY buffer replay on ready', () => {
    it('sends pty:buffers on ready when buffers exist', () => {
      // Pre-populate the mock PtyBridge with buffered data
      ptyBridge.registerSession('s1');
      ptyBridge.pushData('s1', 'hello world');

      // Session must be in tracker so it doesn't get pruned as orphan
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 's1', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      sendMessage({ type: 'ready' });

      const bufferMsg = lastPosted('pty:buffers');
      expect(bufferMsg).toBeDefined();
      expect(bufferMsg.buffers).toEqual({ s1: 'hello world' });
    });

    it('does not send pty:buffers on ready when no buffers exist', () => {
      sendMessage({ type: 'ready' });

      const bufferMsg = postedMessages.find((m) => m.type === 'pty:buffers');
      expect(bufferMsg).toBeUndefined();
    });

    it('replays buffers for multiple sessions', () => {
      ptyBridge.registerSession('s1');
      ptyBridge.pushData('s1', 'output-1');
      ptyBridge.registerSession('s2');
      ptyBridge.pushData('s2', 'output-2');

      // Both sessions must be in tracker
      tracker.getState.mockReturnValue({
        sessions: [
          { sessionId: 's1', startedAt: '2026-01-01' },
          { sessionId: 's2', startedAt: '2026-01-01' },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      sendMessage({ type: 'ready' });

      const bufferMsg = lastPosted('pty:buffers');
      expect(bufferMsg).toBeDefined();
      expect(bufferMsg.buffers).toEqual({ s1: 'output-1', s2: 'output-2' });
    });
  });

  describe('onSessionExit does NOT unregister PtyBridge', () => {
    it('does not call unregisterSession when session exits', () => {
      // Get the onSessionExit callback registered in the constructor
      const exitCallback = launcher.onSessionExit.mock.calls[0]?.[0];

      // If onSessionExit was registered (it was removed), the callback would unregister.
      // Since we removed it, onSessionExit should either not be registered or the callback
      // should not call unregisterSession.
      if (exitCallback) {
        ptyBridge.unregisterSession.mockClear();
        exitCallback({ sessionId: 'exited-session' });
        expect(ptyBridge.unregisterSession).not.toHaveBeenCalled();
      }
      // If no callback was registered at all, that also satisfies the requirement
    });
  });

  describe('launchedByConductor persistence via conductorLaunchedIds', () => {
    it('marks session as launchedByConductor after launch even when isLaunchedSession returns false', () => {
      // Simulate a launched session by calling notifySessionLaunched
      const panel = DashboardPanel.currentPanel!;
      panel.notifySessionLaunched('launched-1');
      postedMessages.length = 0;

      // isLaunchedSession returns false (session exited, removed from SessionLauncher)
      launcher.isLaunchedSession.mockReturnValue(false);

      // Set up tracker to return the session
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'launched-1', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      expect(stateMsg).toBeDefined();
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'launched-1');
      expect(session?.launchedByConductor).toBe(true);
    });
  });

  describe('launchedByConductor via continuation group', () => {
    it('marks session as launchedByConductor when a continuation member was launched', () => {
      const panel = DashboardPanel.currentPanel!;
      // Mark 'member-2' as launched (not the primary session)
      panel.notifySessionLaunched('member-2');
      postedMessages.length = 0;

      launcher.isLaunchedSession.mockReturnValue(false);

      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'primary-id',
            startedAt: '2026-01-01',
            continuationSessionIds: ['primary-id', 'member-2'],
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'primary-id');
      expect(session?.launchedByConductor).toBe(true);
    });

    it('does not mark launchedByConductor when no group member was launched', () => {
      postedMessages.length = 0;
      launcher.isLaunchedSession.mockReturnValue(false);

      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'primary-id',
            startedAt: '2026-01-01',
            continuationSessionIds: ['primary-id', 'member-2'],
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'primary-id');
      expect(session?.launchedByConductor).toBeUndefined();
    });
  });

  describe('PTY ID translation for adopted sessions', () => {
    it('translates resumedId to primaryId in pty:data messages', async () => {
      // Setup: transfer returns a different resumedId than the sessionId
      const resumedId = 'resumed-abc';
      const primaryId = 'primary-group';
      tracker.getGroupMembers.mockReturnValue([primaryId, 'member-2']);
      launcher.isLaunchedSession.mockReturnValue(false);
      launcher.transfer.mockResolvedValue(resumedId);

      // Capture the onPtyData callback
      let ptyDataCallback: ((data: { sessionId: string; data: string }) => void) | undefined;
      launcher.onPtyData.mockImplementation(
        (handler: (data: { sessionId: string; data: string }) => void) => {
          ptyDataCallback = handler;
          return { dispose: vi.fn() };
        }
      );

      // Re-create panel to wire up the new onPtyData mock
      DashboardPanel.currentPanel!.dispose();
      DashboardPanel.currentPanel = undefined;
      DashboardPanel.createOrShow(
        createMockContext(),
        tracker,
        createMockNameStore(),
        createMockOrderStore(),
        createMockVisibilityStore(),
        launcher,
        ptyBridge,
        createMockLaunchedSessionStore(),
        createMockSessionHistoryStore(),
        createMockSessionHistoryService(),
        createMockStatsCacheReader(),
        createMockTileLayoutStore()
      );

      // Trigger adoption with a session that has a different resumedId
      sendMessage({ type: 'session:adopt', sessionId: primaryId });

      // Wait for full adoption to complete (including ptyIdToDisplayId mapping)
      await vi.waitFor(() => {
        const adopted = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'adopted'
        );
        expect(adopted).toBeDefined();
      });

      // Simulate PTY data arriving with the resumedId
      postedMessages.length = 0;
      expect(ptyDataCallback).toBeDefined();
      ptyDataCallback!({ sessionId: resumedId, data: 'hello terminal' });

      // Verify the pty:data message uses the primary display ID, not resumedId
      const ptyMsg = postedMessages.find((m) => m.type === 'pty:data');
      expect(ptyMsg).toBeDefined();
      expect(ptyMsg.sessionId).toBe(primaryId);

      // Verify PtyBridge also received data under primaryId
      expect(ptyBridge.pushData).toHaveBeenCalledWith(primaryId, 'hello terminal');
    });

    it('registers PtyBridge under primaryId when resumedId differs', async () => {
      const resumedId = 'resumed-xyz';
      const primaryId = 'primary-xyz';
      tracker.getGroupMembers.mockReturnValue([primaryId, 'member-3']);
      launcher.isLaunchedSession.mockReturnValue(false);
      launcher.transfer.mockResolvedValue(resumedId);

      sendMessage({ type: 'session:adopt', sessionId: primaryId });

      // Wait for full adoption to complete (including PtyBridge registration)
      await vi.waitFor(() => {
        const adopted = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'adopted'
        );
        expect(adopted).toBeDefined();
      });

      // PtyBridge should have been registered with primaryId
      expect(ptyBridge.registerSession).toHaveBeenCalledWith(primaryId);
    });
  });

  describe('hasActivePty enrichment', () => {
    it('sets hasActivePty when session has a registered PTY', () => {
      ptyBridge.registerSession('pty-session');
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'pty-session', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'pty-session');
      expect(session?.hasActivePty).toBe(true);
    });

    it('does not set hasActivePty when session has no registered PTY', () => {
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'no-pty-session', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'no-pty-session');
      expect(session?.hasActivePty).toBeUndefined();
    });

    it('sets hasActivePty when a continuation member has a registered PTY', () => {
      ptyBridge.registerSession('member-2');
      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'primary-id',
            startedAt: '2026-01-01',
            continuationSessionIds: ['primary-id', 'member-2'],
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'primary-id');
      expect(session?.hasActivePty).toBe(true);
    });

    it('post-restart: launchedByConductor true but hasActivePty false when no PTY registered', () => {
      const panel = DashboardPanel.currentPanel!;
      // Simulate launch (registers PTY), then simulate restart by unregistering PTY
      panel.notifySessionLaunched('restarted-session');
      ptyBridge.unregisterSession('restarted-session');
      postedMessages.length = 0;

      launcher.isLaunchedSession.mockReturnValue(false);

      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'restarted-session', startedAt: '2026-01-01', status: 'idle' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'restarted-session');
      expect(session?.launchedByConductor).toBe(true);
      expect(session?.hasActivePty).toBeUndefined();
    });
  });

  describe('applyVisibility: conductor-launched artifact sessions', () => {
    it('does NOT auto-hide artifact sessions launched by Conductor', () => {
      const panel = DashboardPanel.currentPanel!;
      panel.notifySessionLaunched('artifact-1');
      postedMessages.length = 0;

      launcher.isLaunchedSession.mockReturnValue(false);

      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'artifact-1',
            startedAt: '2026-01-01',
            status: 'idle',
            turnCount: 0,
            toolCallCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            isArtifact: true,
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'artifact-1');
      expect(session?.isHidden).toBeUndefined();
    });

    it('still auto-hides artifact sessions NOT launched by Conductor', () => {
      postedMessages.length = 0;

      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'random-artifact',
            startedAt: '2026-01-01',
            status: 'idle',
            turnCount: 0,
            toolCallCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            isArtifact: true,
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'random-artifact');
      expect(session?.isHidden).toBe(true);
    });
  });

  describe('pruning orphaned PTY buffers', () => {
    it('removes buffers for sessions not in SessionTracker', () => {
      // Register and populate a buffer for a session
      ptyBridge.registerSession('orphan-1');
      ptyBridge.pushData('orphan-1', 'stale data');

      // SessionTracker returns no sessions — orphan-1 should be pruned
      tracker.getState.mockReturnValue({
        sessions: [],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      expect(ptyBridge.unregisterSession).toHaveBeenCalledWith('orphan-1');
    });

    it('retains buffers for sessions still tracked', () => {
      ptyBridge.registerSession('active-1');
      ptyBridge.pushData('active-1', 'keep this');

      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'active-1', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      ptyBridge.unregisterSession.mockClear();
      const panel = DashboardPanel.currentPanel!;
      panel.postFullState();

      // unregisterSession should NOT have been called for active-1
      const unregisterCalls = ptyBridge.unregisterSession.mock.calls.map((c: any[]) => c[0]);
      expect(unregisterCalls).not.toContain('active-1');
    });

    it('protects buffer during discovery window (pendingDiscoveryIds)', () => {
      vi.useFakeTimers();
      try {
        const panel = DashboardPanel.currentPanel!;

        // notifySessionLaunched registers the buffer AND adds to pendingDiscoveryIds
        panel.notifySessionLaunched('discovery-1');

        // SessionTracker returns no sessions — JSONL not yet discovered
        tracker.getState.mockReturnValue({
          sessions: [],
          activities: [],
          conversation: [],
          toolStats: [],
          tokenSummaries: [],
        });

        ptyBridge.unregisterSession.mockClear();
        panel.postFullState();

        // Buffer should survive because sessionId is in pendingDiscoveryIds
        const unregisterCalls = ptyBridge.unregisterSession.mock.calls.map((c: any[]) => c[0]);
        expect(unregisterCalls).not.toContain('discovery-1');
      } finally {
        vi.useRealTimers();
      }
    });

    it('buffer is prunable after discovery poll completes', () => {
      vi.useFakeTimers();
      try {
        const panel = DashboardPanel.currentPanel!;

        // notifySessionLaunched starts the discovery poll
        panel.notifySessionLaunched('discovery-2');

        // SessionTracker never finds the session — simulate max retries exhausted
        tracker.getState.mockReturnValue({
          sessions: [],
          activities: [],
          conversation: [],
          toolStats: [],
          tokenSummaries: [],
        });

        // Clear mock before advancing — the final poll tick calls postFullState()
        // which prunes the buffer once pendingDiscoveryIds no longer protects it
        ptyBridge.unregisterSession.mockClear();

        // Advance past all discovery poll retries
        const totalPollTime = TIMING.LAUNCH_DISCOVERY_POLL_MS * TIMING.LAUNCH_DISCOVERY_MAX_RETRIES;
        vi.advanceTimersByTime(totalPollTime);

        // The last poll tick removed from pendingDiscoveryIds then called postFullState → prune
        const unregisterCalls = ptyBridge.unregisterSession.mock.calls.map((c: any[]) => c[0]);
        expect(unregisterCalls).toContain('discovery-2');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('settings IPC', () => {
    beforeEach(() => {
      // Reset config values between tests
      for (const key of Object.keys(mockConfigValues)) {
        delete mockConfigValues[key];
      }
      mockConfigUpdate.mockClear();
    });

    it('responds to settings:get with settings:current', () => {
      mockConfigValues['conductor.autoHidePatterns'] = ['test-pattern', 'other'];

      sendMessage({ type: 'settings:get' });

      const settingsMsg = lastPosted('settings:current');
      expect(settingsMsg).toBeDefined();
      expect(settingsMsg.autoHidePatterns).toEqual(['test-pattern', 'other']);
    });

    it('sends settings:current on ready', () => {
      mockConfigValues['conductor.autoHidePatterns'] = ['pattern-a'];

      sendMessage({ type: 'ready' });

      const settingsMsg = lastPosted('settings:current');
      expect(settingsMsg).toBeDefined();
      expect(settingsMsg.autoHidePatterns).toEqual(['pattern-a']);
    });

    it('defaults to empty array when no patterns configured', () => {
      // mockConfigValues has no entry for autoHidePatterns → get returns undefined → ?? []

      sendMessage({ type: 'settings:get' });

      const settingsMsg = lastPosted('settings:current');
      expect(settingsMsg).toBeDefined();
      expect(settingsMsg.autoHidePatterns).toEqual([]);
    });

    it('writes to config and responds on settings:update', async () => {
      sendMessage({ type: 'settings:update', autoHidePatterns: ['new-pattern'] });

      expect(mockConfigUpdate).toHaveBeenCalledWith(
        'conductor.autoHidePatterns',
        ['new-pattern'],
        1 // ConfigurationTarget.Global
      );

      // Wait for the promise chain (.then) to complete
      await vi.waitFor(() => {
        const settingsMsg = lastPosted('settings:current');
        expect(settingsMsg).toBeDefined();
      });
    });
  });

  describe('launch mode forwarding', () => {
    it('forwards mode from session:launch IPC to sessionLauncher.launch()', async () => {
      launcher.launch.mockResolvedValue('yolo-session-id');

      sendMessage({ type: 'session:launch', mode: 'yolo' });

      expect(launcher.launch).toHaveBeenCalledWith(undefined, 'yolo');
    });

    it('forwards cwd and mode together from session:launch', async () => {
      launcher.launch.mockResolvedValue('new-session-id');

      sendMessage({ type: 'session:launch', cwd: '/home/user/project', mode: 'normal' });

      expect(launcher.launch).toHaveBeenCalledWith('/home/user/project', 'normal');
    });

    it('defaults to normal mode when mode is omitted from session:launch', async () => {
      launcher.launch.mockResolvedValue('normal-session-id');

      sendMessage({ type: 'session:launch' });

      expect(launcher.launch).toHaveBeenCalledWith(undefined, LAUNCH_MODES.NORMAL);
    });
  });

  describe('launch mode persistence (session:set-launch-mode)', () => {
    it('persists launch mode to workspace state on session:set-launch-mode', () => {
      sendMessage({ type: 'session:set-launch-mode', mode: 'yolo' });

      expect(mockWorkspaceStateStore[WORKSPACE_STATE_KEYS.LAUNCH_MODE]).toBe('yolo');
    });

    it('sends launch-mode:current on ready with persisted mode', () => {
      // Pre-set the persisted mode
      mockWorkspaceStateStore[WORKSPACE_STATE_KEYS.LAUNCH_MODE] = 'yolo';

      sendMessage({ type: 'ready' });

      const modeMsg = lastPosted('launch-mode:current');
      expect(modeMsg).toBeDefined();
      expect(modeMsg.mode).toBe('yolo');
    });

    it('sends launch-mode:current with normal as default when no mode persisted', () => {
      sendMessage({ type: 'ready' });

      const modeMsg = lastPosted('launch-mode:current');
      expect(modeMsg).toBeDefined();
      expect(modeMsg.mode).toBe('normal');
    });
  });

  describe('overview mode persistence (overview-mode:set)', () => {
    it('persists overview mode to workspace state on overview-mode:set', () => {
      sendMessage({ type: 'overview-mode:set', mode: 'board' });

      expect(mockWorkspaceStateStore[WORKSPACE_STATE_KEYS.OVERVIEW_MODE]).toBe('board');
    });

    it('sends overview-mode:current on ready with persisted mode', () => {
      mockWorkspaceStateStore[WORKSPACE_STATE_KEYS.OVERVIEW_MODE] = 'board';

      sendMessage({ type: 'ready' });

      const modeMsg = lastPosted('overview-mode:current');
      expect(modeMsg).toBeDefined();
      expect(modeMsg.mode).toBe('board');
    });

    it('sends overview-mode:current with list as default when no mode persisted', () => {
      sendMessage({ type: 'ready' });

      const modeMsg = lastPosted('overview-mode:current');
      expect(modeMsg).toBeDefined();
      expect(modeMsg.mode).toBe('list');
    });
  });

  describe('kanban sort orders persistence (kanban-sort-orders:set)', () => {
    it('persists sort orders to workspace state on kanban-sort-orders:set', () => {
      const sortOrders = { performing: 'asc' as const, completed: 'desc' as const };
      sendMessage({ type: 'kanban-sort-orders:set', sortOrders });

      expect(mockWorkspaceStateStore[WORKSPACE_STATE_KEYS.KANBAN_SORT_ORDERS]).toEqual(sortOrders);
    });

    it('sends kanban-sort-orders:current on ready with persisted orders', () => {
      const sortOrders = { performing: 'asc' as const };
      mockWorkspaceStateStore[WORKSPACE_STATE_KEYS.KANBAN_SORT_ORDERS] = sortOrders;

      sendMessage({ type: 'ready' });

      const sortMsg = lastPosted('kanban-sort-orders:current');
      expect(sortMsg).toBeDefined();
      expect(sortMsg.sortOrders).toEqual(sortOrders);
    });

    it('sends kanban-sort-orders:current with empty object as default when nothing persisted', () => {
      sendMessage({ type: 'ready' });

      const sortMsg = lastPosted('kanban-sort-orders:current');
      expect(sortMsg).toBeDefined();
      expect(sortMsg.sortOrders).toEqual({});
    });
  });

  describe('launchMode injection into SessionInfo', () => {
    it('injects launchMode into SessionInfo for sessions launched with yolo mode', async () => {
      launcher.launch.mockResolvedValue('yolo-session-id');

      sendMessage({ type: 'session:launch', mode: 'yolo' });

      // Wait for the .then() callback to complete (posts session:launch-status)
      await vi.waitFor(() => {
        const launchStatus = postedMessages.find((m) => m.type === 'session:launch-status');
        expect(launchStatus).toBeDefined();
      });

      // Set up tracker to return the launched session
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'yolo-session-id', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      postedMessages.length = 0;
      DashboardPanel.currentPanel!.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'yolo-session-id');
      expect(session?.launchMode).toBe('yolo');
    });

    it('does not inject launchMode for sessions launched with normal mode', async () => {
      launcher.launch.mockResolvedValue('normal-session-id');

      sendMessage({ type: 'session:launch', mode: 'normal' });

      // Wait for the .then() callback to complete
      await vi.waitFor(() => {
        const launchStatus = postedMessages.find((m) => m.type === 'session:launch-status');
        expect(launchStatus).toBeDefined();
      });

      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'normal-session-id', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      postedMessages.length = 0;
      DashboardPanel.currentPanel!.postFullState();

      const stateMsg = lastPosted('state:full');
      const session = stateMsg.sessions.find((s: any) => s.sessionId === 'normal-session-id');
      // Normal mode sessions should not have launchMode set (or it should be undefined)
      expect(session?.launchMode).toBeUndefined();
    });
  });
});

describe('DashboardPanel session ordering', () => {
  let tracker: ReturnType<typeof createMockSessionTracker>;
  let orderStore: ReturnType<typeof createMockOrderStore>;

  /** Helper to create a minimal SessionInfo stub */
  function makeSession(id: string, startedAt = '2026-01-01T00:00:00Z'): any {
    return { sessionId: id, startedAt };
  }

  beforeEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;

    postedMessages.length = 0;
    messageHandler = undefined;

    tracker = createMockSessionTracker();
    orderStore = createMockOrderStore();

    DashboardPanel.createOrShow(
      createMockContext(),
      tracker,
      createMockNameStore(),
      orderStore,
      createMockVisibilityStore(),
      createMockSessionLauncher(),
      createMockPtyBridge(),
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    postedMessages.length = 0;
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  it('returns all sessions when cachedOrder is empty (fresh install)', () => {
    tracker.getState.mockReturnValue({
      sessions: [makeSession('a'), makeSession('b'), makeSession('c')],
      activities: [],
      conversation: [],
      toolStats: [],
      tokenSummaries: [],
    });

    sendMessage({ type: 'ready' });

    const stateMsg = lastPosted('state:full');
    const ids = stateMsg.sessions.map((s: any) => s.sessionId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toHaveLength(3);
  });

  it('returns all sessions when cachedOrder is partial (primary bug)', () => {
    // Simulate a stored order that only knows about 'a' and 'b'
    orderStore._setOrderDirect(['a', 'b']);

    tracker.getState.mockReturnValue({
      sessions: [makeSession('a'), makeSession('b'), makeSession('c'), makeSession('d')],
      activities: [],
      conversation: [],
      toolStats: [],
      tokenSummaries: [],
    });

    sendMessage({ type: 'ready' });

    const stateMsg = lastPosted('state:full');
    const ids = stateMsg.sessions.map((s: any) => s.sessionId);
    // All 4 sessions must be present — 'c' and 'd' appended, not dropped
    expect(ids).toHaveLength(4);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toContain('d');
    // 'a' and 'b' should come first (from order)
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('d'));
  });

  it('session:reorder merges with existing order (preserves hidden IDs)', () => {
    // Start with 3 sessions in stored order
    orderStore._setOrderDirect(['a', 'b', 'c']);

    // Webview sends reorder with only visible sessions (b is hidden)
    sendMessage({ type: 'session:reorder', sessionIds: ['c', 'a'] });

    // setOrder should have been called with merged order preserving 'b'
    expect(orderStore.setOrder).toHaveBeenCalled();
    const savedOrder = orderStore.setOrder.mock.calls[0][0];
    expect(savedOrder).toEqual(['c', 'a', 'b']);
  });

  it('new sessions are appended when not yet in stored order', () => {
    // Only 'a' and 'b' are in stored order
    orderStore._setOrderDirect(['a', 'b']);

    tracker.getState.mockReturnValue({
      sessions: [makeSession('a'), makeSession('b'), makeSession('new-1')],
      activities: [],
      conversation: [],
      toolStats: [],
      tokenSummaries: [],
    });

    const panel = DashboardPanel.currentPanel!;
    panel.postFullState();

    const stateMsg = lastPosted('state:full');
    const ids = stateMsg.sessions.map((s: any) => s.sessionId);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('new-1');
    // new-1 should be at the end
    expect(ids.indexOf('new-1')).toBe(2);
  });
});

// ── History feature tests ────────────────────────────────────────────

describe('DashboardPanel history support', () => {
  let tracker: ReturnType<typeof createMockSessionTracker>;
  let launcher: ReturnType<typeof createMockSessionLauncher>;
  let ptyBridge: ReturnType<typeof createMockPtyBridge>;
  let historyService: ReturnType<typeof createMockSessionHistoryService>;
  let historyStore: ReturnType<typeof createMockSessionHistoryStore>;
  let launchedStore: ReturnType<typeof createMockLaunchedSessionStore>;

  beforeEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;

    postedMessages.length = 0;
    messageHandler = undefined;

    for (const key of Object.keys(mockWorkspaceStateStore)) {
      delete mockWorkspaceStateStore[key];
    }

    tracker = createMockSessionTracker();
    launcher = createMockSessionLauncher();
    ptyBridge = createMockPtyBridge();
    historyService = createMockSessionHistoryService();
    historyStore = createMockSessionHistoryStore();
    launchedStore = createMockLaunchedSessionStore();

    DashboardPanel.createOrShow(
      createMockContext(),
      tracker,
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      launcher,
      ptyBridge,
      launchedStore,
      historyStore,
      historyService,
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    postedMessages.length = 0;
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  describe('pruneOrphanedPtyBuffers does not remove from launchedSessionStore', () => {
    it('keeps launchedSessionStore entries when sessions leave SessionTracker', () => {
      // Register a PTY buffer for a session
      ptyBridge.registerSession('orphan-id');

      // Trigger postFullState with no sessions → prunes orphaned PTY buffers
      tracker.getState.mockReturnValue({
        sessions: [],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      // PTY buffer should be unregistered
      expect(ptyBridge.unregisterSession).toHaveBeenCalledWith('orphan-id');
      // But launchedSessionStore.remove should NOT be called
      expect(launchedStore.remove).not.toHaveBeenCalled();
    });
  });

  describe('usage:request', () => {
    it('calls statsCacheReader.read and posts usage:full', async () => {
      const mockStats = {
        version: 1,
        lastComputedDate: '2026-02-27',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 10,
        totalMessages: 100,
        longestSession: {
          sessionId: 'a',
          duration: 1000,
          messageCount: 5,
          timestamp: '2026-02-27T00:00:00Z',
        },
        firstSessionDate: '2026-01-01',
        hourCounts: {},
      };

      // Get the statsCacheReader mock — recreate the panel with a custom reader
      DashboardPanel.currentPanel?.dispose();
      DashboardPanel.currentPanel = undefined;
      postedMessages.length = 0;
      messageHandler = undefined;

      const statsCacheReader = createMockStatsCacheReader();
      statsCacheReader.read.mockResolvedValue(mockStats);

      DashboardPanel.createOrShow(
        createMockContext(),
        tracker,
        createMockNameStore(),
        createMockOrderStore(),
        createMockVisibilityStore(),
        launcher,
        ptyBridge,
        launchedStore,
        historyStore,
        historyService,
        statsCacheReader,
        createMockTileLayoutStore()
      );
      postedMessages.length = 0;

      sendMessage({ type: 'usage:request' });

      await vi.waitFor(() => {
        const usageMsg = lastPosted('usage:full');
        expect(usageMsg).toBeDefined();
        expect(usageMsg.stats).toEqual(mockStats);
      });
    });

    it('posts usage:full with null when reader returns null', async () => {
      sendMessage({ type: 'usage:request' });

      await vi.waitFor(() => {
        const usageMsg = lastPosted('usage:full');
        expect(usageMsg).toBeDefined();
        expect(usageMsg.stats).toBeNull();
      });
    });
  });

  describe('history:request', () => {
    it('calls sessionHistoryService.buildEntries and posts history:full', () => {
      const mockEntries = [
        {
          sessionId: 'hist-1',
          displayName: 'Test',
          cwd: '/test',
          lastActivityAt: '2026-02-27T00:00:00Z',
          isActive: false,
        },
      ];
      historyService.buildEntries.mockReturnValue(mockEntries);

      sendMessage({ type: 'history:request' });

      expect(historyService.buildEntries).toHaveBeenCalled();
      const historyMsg = lastPosted('history:full');
      expect(historyMsg).toBeDefined();
      expect(historyMsg.entries).toEqual(mockEntries);
    });
  });

  describe('history:resume', () => {
    it('focuses active session with terminal instead of relaunching', () => {
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'active-session', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      // Session has a Conductor terminal → focus path
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'active-session');

      sendMessage({ type: 'history:resume', sessionId: 'active-session' });

      // Should send a focus command, not call resume()
      const focusMsg = lastPosted('session:focus-command');
      expect(focusMsg).toBeDefined();
      expect(focusMsg.sessionId).toBe('active-session');
      expect(launcher.resume).not.toHaveBeenCalled();
    });

    it('calls sessionLauncher.resume() for inactive sessions', async () => {
      tracker.getState.mockReturnValue({
        sessions: [],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      historyStore.get.mockReturnValue({
        sessionId: 'old-session',
        cwd: '/old/workspace',
        displayName: 'Old',
        filePath: '/path/old.jsonl',
        savedAt: Date.now(),
      });

      sendMessage({ type: 'history:resume', sessionId: 'old-session' });

      // Should call resume with the stored CWD
      await vi.waitFor(() => {
        expect(launcher.resume).toHaveBeenCalledWith('old-session', '', '/old/workspace');
      });
    });

    it('focuses active group member when history ID is an older continuation member', () => {
      // "session-v1" is the history ID, but "session-v2" is the active continuation
      // getGroupMembers returns both members for any group ID
      tracker.getGroupMembers.mockImplementation((id: string) => {
        if (id === 'session-v1' || id === 'session-v2') {
          return ['session-v1', 'session-v2'];
        }
        return [id];
      });
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'session-v2', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      // session-v2 has a terminal
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'session-v2');

      sendMessage({ type: 'history:resume', sessionId: 'session-v1' });

      // Should focus, NOT spawn a new resume
      const focusMsg = lastPosted('session:focus-command');
      expect(focusMsg).toBeDefined();
      expect(launcher.resume).not.toHaveBeenCalled();
    });

    it('adopts when active group member exists but has no Conductor terminal', async () => {
      // "session-v1" is in history; "session-v2" is active but running in external terminal
      tracker.getGroupMembers.mockImplementation((id: string) => {
        if (id === 'session-v1' || id === 'session-v2') {
          return ['session-v1', 'session-v2'];
        }
        return [id];
      });
      tracker.getState.mockReturnValue({
        sessions: [{ sessionId: 'session-v2', startedAt: '2026-01-01' }],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      // No Conductor terminal for any group member
      launcher.isLaunchedSession.mockReturnValue(false);
      // transfer() succeeds (used internally by adoptSession)
      launcher.transfer.mockResolvedValue('session-v2');

      sendMessage({ type: 'history:resume', sessionId: 'session-v1' });

      // Should call transfer (adopt path), not resume
      await vi.waitFor(() => {
        expect(launcher.transfer).toHaveBeenCalled();
      });
      expect(launcher.resume).not.toHaveBeenCalled();
    });

    it('resumes inactive session by exact ID with no group matches', async () => {
      // No group members active
      tracker.getGroupMembers.mockReturnValue(['standalone-session']);
      tracker.getState.mockReturnValue({
        sessions: [],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      historyStore.get.mockReturnValue({
        sessionId: 'standalone-session',
        cwd: '/workspace',
        displayName: 'Test',
        filePath: '/path/test.jsonl',
        savedAt: Date.now(),
      });

      sendMessage({ type: 'history:resume', sessionId: 'standalone-session' });

      await vi.waitFor(() => {
        expect(launcher.resume).toHaveBeenCalledWith('standalone-session', '', '/workspace');
      });
    });
  });
});

// ── Race condition fix tests ─────────────────────────────────────────

describe('DashboardPanel race condition guards', () => {
  let tracker: ReturnType<typeof createMockSessionTracker>;
  let launcher: ReturnType<typeof createMockSessionLauncher>;

  beforeEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;

    postedMessages.length = 0;
    messageHandler = undefined;

    for (const key of Object.keys(mockWorkspaceStateStore)) {
      delete mockWorkspaceStateStore[key];
    }

    tracker = createMockSessionTracker();
    launcher = createMockSessionLauncher();

    DashboardPanel.createOrShow(
      createMockContext(),
      tracker,
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      launcher,
      createMockPtyBridge(),
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    postedMessages.length = 0;
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  describe('activity:full includes sessionId', () => {
    it('includes focusedSessionId in activity:full messages', () => {
      sendMessage({ type: 'session:focus', sessionId: 'session-a' });

      const activityMsg = lastPosted('activity:full');
      expect(activityMsg).toBeDefined();
      expect(activityMsg.sessionId).toBe('session-a');
    });

    it('includes null sessionId when no session is focused', () => {
      sendMessage({ type: 'session:focus', sessionId: null });

      const activityMsg = lastPosted('activity:full');
      expect(activityMsg).toBeDefined();
      expect(activityMsg.sessionId).toBeNull();
    });
  });

  describe('conversation:full includes sessionId', () => {
    it('includes focusedSessionId in conversation:full messages', () => {
      sendMessage({ type: 'session:focus', sessionId: 'session-b' });

      const convMsg = lastPosted('conversation:full');
      expect(convMsg).toBeDefined();
      expect(convMsg.sessionId).toBe('session-b');
    });
  });

  describe('state:full includes focusedSessionId', () => {
    it('includes focusedSessionId in state:full messages', () => {
      // Focus a session first
      sendMessage({ type: 'session:focus', sessionId: 'session-c' });
      postedMessages.length = 0;

      // Trigger a state:full via ready
      sendMessage({ type: 'ready' });

      const stateMsg = lastPosted('state:full');
      expect(stateMsg).toBeDefined();
      expect(stateMsg.focusedSessionId).toBe('session-c');
    });

    it('includes null focusedSessionId when no session is focused', () => {
      sendMessage({ type: 'ready' });

      const stateMsg = lastPosted('state:full');
      expect(stateMsg).toBeDefined();
      expect(stateMsg.focusedSessionId).toBeNull();
    });
  });

  describe('focusSession sends focus-command before data messages', () => {
    it('sends session:focus-command before activity:full and conversation:full', () => {
      const panel = DashboardPanel.currentPanel!;
      panel.focusSession('session-d');

      const focusIdx = postedMessages.findIndex((m) => m.type === 'session:focus-command');
      const activityIdx = postedMessages.findIndex((m) => m.type === 'activity:full');
      const convIdx = postedMessages.findIndex((m) => m.type === 'conversation:full');

      expect(focusIdx).toBeGreaterThanOrEqual(0);
      expect(activityIdx).toBeGreaterThanOrEqual(0);
      expect(convIdx).toBeGreaterThanOrEqual(0);
      expect(focusIdx).toBeLessThan(activityIdx);
      expect(focusIdx).toBeLessThan(convIdx);
    });
  });
});

// ── Panel visibility relayout tests ──────────────────────────────────

describe('DashboardPanel visibility relayout', () => {
  beforeEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;

    postedMessages.length = 0;
    messageHandler = undefined;
    viewStateHandler = undefined;

    for (const key of Object.keys(mockWorkspaceStateStore)) {
      delete mockWorkspaceStateStore[key];
    }

    DashboardPanel.createOrShow(
      createMockContext(),
      createMockSessionTracker(),
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      createMockSessionLauncher(),
      createMockPtyBridge(),
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    postedMessages.length = 0;
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  /** Simulate an onDidChangeViewState event. */
  function fireViewState(visible: boolean, active: boolean): void {
    if (!viewStateHandler) throw new Error('No viewState handler registered');
    viewStateHandler({ webviewPanel: { visible, active } });
  }

  it('sends panel:visible on hidden→visible transition', () => {
    // Panel starts visible. Make it hidden first.
    fireViewState(false, false);
    postedMessages.length = 0;

    // Now make it visible again
    fireViewState(true, true);

    const visibilityMsg = postedMessages.find((m) => m.type === 'panel:visible');
    expect(visibilityMsg).toBeDefined();
  });

  it('does NOT send panel:visible on focus-only change (panel stays visible)', () => {
    // Panel is visible and active
    fireViewState(true, true);
    postedMessages.length = 0;

    // Panel loses focus but stays visible (user clicked another editor column)
    fireViewState(true, false);
    postedMessages.length = 0;

    // Panel gains focus again (still visible)
    fireViewState(true, true);

    const visibilityMsg = postedMessages.find((m) => m.type === 'panel:visible');
    expect(visibilityMsg).toBeUndefined();
  });

  it('does NOT send panel:visible when panel becomes hidden', () => {
    fireViewState(false, false);

    const visibilityMsg = postedMessages.find((m) => m.type === 'panel:visible');
    expect(visibilityMsg).toBeUndefined();
  });

  it('sends panel:visible on each hidden→visible cycle', () => {
    // First cycle: hide then show
    fireViewState(false, false);
    fireViewState(true, true);
    const firstCount = postedMessages.filter((m) => m.type === 'panel:visible').length;
    expect(firstCount).toBe(1);

    // Second cycle: hide then show
    fireViewState(false, false);
    fireViewState(true, true);
    const secondCount = postedMessages.filter((m) => m.type === 'panel:visible').length;
    expect(secondCount).toBe(2);
  });
});

describe('DashboardPanel focus context', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
    postedMessages.length = 0;
    messageHandler = undefined;
    viewStateHandler = undefined;

    const vscode = await import('vscode');
    mockExecuteCommand = vi.mocked(vscode.commands.executeCommand);
    mockExecuteCommand.mockClear();
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  it('sets conductor.panelFocused context to true on initial creation', () => {
    DashboardPanel.createOrShow(
      createMockContext(),
      createMockSessionTracker(),
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      createMockSessionLauncher(),
      createMockPtyBridge(),
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    expect(mockExecuteCommand).toHaveBeenCalledWith('setContext', 'conductor.panelFocused', true);
  });

  it('sets conductor.panelFocused context to true when revealing existing panel', () => {
    // Create the panel
    DashboardPanel.createOrShow(
      createMockContext(),
      createMockSessionTracker(),
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      createMockSessionLauncher(),
      createMockPtyBridge(),
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    mockExecuteCommand.mockClear();

    // Reveal the existing panel
    DashboardPanel.createOrShow(
      createMockContext(),
      createMockSessionTracker(),
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      createMockSessionLauncher(),
      createMockPtyBridge(),
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    expect(mockExecuteCommand).toHaveBeenCalledWith('setContext', 'conductor.panelFocused', true);
  });
});

// ── PTY routing for continuation sessions ────────────────────────────

describe('DashboardPanel PTY routing for continuation sessions', () => {
  let tracker: ReturnType<typeof createMockSessionTracker>;
  let launcher: ReturnType<typeof createMockSessionLauncher>;
  let ptyBridge: ReturnType<typeof createMockPtyBridge>;

  /** The preSpawnCallback captured from setPreSpawnCallback. */
  let capturedPreSpawnCallback: ((sid: string) => void) | undefined;

  beforeEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
    postedMessages.length = 0;
    messageHandler = undefined;
    viewStateHandler = undefined;

    for (const key of Object.keys(mockWorkspaceStateStore)) {
      delete mockWorkspaceStateStore[key];
    }

    tracker = createMockSessionTracker();
    launcher = createMockSessionLauncher();
    ptyBridge = createMockPtyBridge();

    // Capture the preSpawnCallback when setPreSpawnCallback is called
    capturedPreSpawnCallback = undefined;
    launcher.setPreSpawnCallback.mockImplementation((cb: (sid: string) => void) => {
      capturedPreSpawnCallback = cb;
    });

    DashboardPanel.createOrShow(
      createMockContext(),
      tracker,
      createMockNameStore(),
      createMockOrderStore(),
      createMockVisibilityStore(),
      launcher,
      ptyBridge,
      createMockLaunchedSessionStore(),
      createMockSessionHistoryStore(),
      createMockSessionHistoryService(),
      createMockStatsCacheReader(),
      createMockTileLayoutStore()
    );

    postedMessages.length = 0;
  });

  afterEach(() => {
    DashboardPanel.currentPanel?.dispose();
    DashboardPanel.currentPanel = undefined;
  });

  describe('preSpawnCallback', () => {
    it('registers PtyBridge under primary ID for continuation sessions', () => {
      // Session 'continuation-99' belongs to group ['primary-aa', 'continuation-99']
      tracker.getGroupMembers.mockReturnValue(['primary-aa', 'continuation-99']);

      capturedPreSpawnCallback!('continuation-99');

      // PtyBridge should be registered under the primary display ID
      expect(ptyBridge.registerSession).toHaveBeenCalledWith('primary-aa');
      expect(ptyBridge.registerSession).not.toHaveBeenCalledWith('continuation-99');
    });

    it('registers PtyBridge under own ID for fresh launches (single-member group)', () => {
      // Fresh launch: new UUID is the only member
      tracker.getGroupMembers.mockReturnValue(['fresh-uuid']);

      capturedPreSpawnCallback!('fresh-uuid');

      expect(ptyBridge.registerSession).toHaveBeenCalledWith('fresh-uuid');
    });

    it('registers PtyBridge under own ID when sid IS the primary', () => {
      // Session is the primary of its own group — no redirect needed
      tracker.getGroupMembers.mockReturnValue(['primary-aa', 'continuation-99']);

      capturedPreSpawnCallback!('primary-aa');

      expect(ptyBridge.registerSession).toHaveBeenCalledWith('primary-aa');
    });
  });

  describe('pty:input reverse routing', () => {
    it('routes input to PTY session ID when display ID differs', () => {
      // Set up: continuation session 'pty-id' maps to display 'display-id'
      tracker.getGroupMembers.mockReturnValue(['display-id', 'pty-id']);
      capturedPreSpawnCallback!('pty-id');

      // The PTY session is launched — display-id is NOT launched
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'pty-id');

      // Webview sends input with displayId
      sendMessage({ type: 'pty:input', sessionId: 'display-id', data: 'hello' });

      expect(launcher.writeInput).toHaveBeenCalledWith('pty-id', 'hello');
    });

    it('routes input directly when display ID is a launched session', () => {
      // Fresh launch — display ID is the same as PTY session ID
      tracker.getGroupMembers.mockReturnValue(['same-id']);
      capturedPreSpawnCallback!('same-id');

      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'same-id');

      sendMessage({ type: 'pty:input', sessionId: 'same-id', data: 'world' });

      expect(launcher.writeInput).toHaveBeenCalledWith('same-id', 'world');
    });
  });

  describe('pty:resize reverse routing', () => {
    it('routes resize to PTY session ID when display ID differs', () => {
      tracker.getGroupMembers.mockReturnValue(['display-id', 'pty-id']);
      capturedPreSpawnCallback!('pty-id');

      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'pty-id');

      sendMessage({ type: 'pty:resize', sessionId: 'display-id', cols: 120, rows: 40 });

      expect(launcher.resize).toHaveBeenCalledWith('pty-id', 120, 40);
    });
  });

  describe('pruneOrphanedPtyBuffers with continuation IDs', () => {
    it('does not prune buffers registered under a continuation member ID', () => {
      // Register buffer under primary (simulating preSpawnCallback for continuation)
      tracker.getGroupMembers.mockReturnValue(['primary-aa', 'cont-bb']);
      capturedPreSpawnCallback!('cont-bb');

      // primary-aa should be registered in PtyBridge
      expect(ptyBridge.hasSession('primary-aa')).toBe(true);

      // Post state with sessions that include continuation IDs
      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'primary-aa',
            continuationSessionIds: ['cont-bb'],
            status: 'working',
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      // postFullState triggers pruning
      DashboardPanel.currentPanel!.postFullState();

      // Buffer for primary-aa should NOT be pruned (it's in knownIds)
      expect(ptyBridge.unregisterSession).not.toHaveBeenCalledWith('primary-aa');
    });
  });

  describe('stale ptyIdToDisplayId cleanup', () => {
    it('removes mapping for dead PTY sessions during prune', () => {
      // Set up a continuation mapping
      tracker.getGroupMembers.mockReturnValue(['display-id', 'pty-id']);
      capturedPreSpawnCallback!('pty-id');

      // Initially the PTY session is alive
      launcher.isLaunchedSession.mockImplementation((id: string) => id === 'pty-id');

      // Verify reverse routing works
      sendMessage({ type: 'pty:input', sessionId: 'display-id', data: 'test' });
      expect(launcher.writeInput).toHaveBeenCalledWith('pty-id', 'test');
      launcher.writeInput.mockClear();

      // Now the PTY session dies
      launcher.isLaunchedSession.mockReturnValue(false);

      // Trigger a state update which invokes pruneOrphanedPtyBuffers
      tracker.getState.mockReturnValue({
        sessions: [
          {
            sessionId: 'display-id',
            continuationSessionIds: ['pty-id'],
            status: 'idle',
          },
        ],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      DashboardPanel.currentPanel!.postFullState();

      // After cleanup, reverse routing should fall through to displayId
      sendMessage({ type: 'pty:input', sessionId: 'display-id', data: 'after' });
      expect(launcher.writeInput).toHaveBeenCalledWith('display-id', 'after');
    });
  });

  describe('user:send-input — Path C adoption sends adopt-status', () => {
    it('posts session:adopt-status after successful adoption via handleSendInput', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.isLaunchedSession.mockReturnValue(false);
      launcher.transfer.mockResolvedValue('ext-session');

      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'hello' });

      await vi.waitFor(() => {
        const adoptStatus = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'adopted'
        );
        expect(adoptStatus).toBeDefined();
        expect(adoptStatus.sessionId).toBe('ext-session');
      });
    });
  });

  describe('notifySessionReconnected', () => {
    it('posts session:adopt-status with resolved display ID', () => {
      tracker.getGroupMembers.mockReturnValue(['primary-id', 'cont-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('cont-id');

      const adoptStatus = lastPosted('session:adopt-status');
      expect(adoptStatus).toBeDefined();
      expect(adoptStatus.sessionId).toBe('primary-id');
      expect(adoptStatus.status).toBe('adopted');
    });

    it('falls back to sessionId when no group members', () => {
      tracker.getGroupMembers.mockReturnValue([]);

      DashboardPanel.currentPanel!.notifySessionReconnected('standalone-id');

      const adoptStatus = lastPosted('session:adopt-status');
      expect(adoptStatus).toBeDefined();
      expect(adoptStatus.sessionId).toBe('standalone-id');
      expect(adoptStatus.status).toBe('adopted');
    });
  });

  describe('ghost continuation filtering', () => {
    /** Helper to create a minimal SessionInfo for testing. */
    function makeSession(
      overrides: Partial<import('../models/types').SessionInfo> = {}
    ): import('../models/types').SessionInfo {
      return {
        sessionId: 'ghost-session',
        slug: 'ghost-se',
        summary: '',
        status: 'idle',
        model: '',
        gitBranch: '',
        cwd: '/projects/myapp',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        turnCount: 0,
        toolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        isSubAgent: false,
        isArtifact: false,
        filePath: '/tmp/test.jsonl',
        ...overrides,
      };
    }

    it('filters ghost session with matching cwd, 0 turns, 0 tokens after resume', () => {
      // Simulate a resume operation via notifySessionReconnected
      const resumedSession = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumedSession],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');
      postedMessages.length = 0;

      // Now a ghost session appears with the same cwd
      const ghost = makeSession({ sessionId: 'ghost-session', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumedSession, ghost],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const fullState = lastPosted('state:full');
      const sessionIds = fullState.sessions.map((s: any) => s.sessionId);
      expect(sessionIds).not.toContain('ghost-session');
      expect(sessionIds).toContain('original-id');
    });

    it('does NOT filter session with turns > 0', () => {
      const resumed = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');
      postedMessages.length = 0;

      const realSession = makeSession({
        sessionId: 'real-session',
        cwd: '/projects/myapp',
        turnCount: 1,
      });
      tracker.getState.mockReturnValue({
        sessions: [resumed, realSession],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const fullState = lastPosted('state:full');
      const sessionIds = fullState.sessions.map((s: any) => s.sessionId);
      expect(sessionIds).toContain('real-session');
    });

    it('does NOT filter session outside time window', () => {
      const resumed = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');

      // Manually expire the resume entry by backdating it
      const panel = DashboardPanel.currentPanel as any;
      const entry = panel.recentResumes.get('/projects/myapp');
      entry.timestamp = Date.now() - TIMING.GHOST_CONTINUATION_WINDOW_MS - 1;
      postedMessages.length = 0;

      const ghost = makeSession({ sessionId: 'ghost-session', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed, ghost],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const fullState = lastPosted('state:full');
      const sessionIds = fullState.sessions.map((s: any) => s.sessionId);
      expect(sessionIds).toContain('ghost-session');
    });

    it('does NOT filter sub-agent sessions', () => {
      const resumed = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');
      postedMessages.length = 0;

      const subAgent = makeSession({
        sessionId: 'subagent-session',
        cwd: '/projects/myapp',
        isSubAgent: true,
      });
      tracker.getState.mockReturnValue({
        sessions: [resumed, subAgent],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const fullState = lastPosted('state:full');
      const sessionIds = fullState.sessions.map((s: any) => s.sessionId);
      expect(sessionIds).toContain('subagent-session');
    });

    it('does NOT filter sessions in conductorLaunchedIds', () => {
      const resumed = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');
      postedMessages.length = 0;

      // Mark the session as conductor-launched
      DashboardPanel.currentPanel!.notifySessionLaunched('launched-ghost', '/projects/myapp');
      postedMessages.length = 0;

      const launchedSession = makeSession({
        sessionId: 'launched-ghost',
        cwd: '/projects/myapp',
      });
      tracker.getState.mockReturnValue({
        sessions: [resumed, launchedSession],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const fullState = lastPosted('state:full');
      const sessionIds = fullState.sessions.map((s: any) => s.sessionId);
      expect(sessionIds).toContain('launched-ghost');
    });

    it('does NOT filter session with no matching cwd', () => {
      const resumed = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');
      postedMessages.length = 0;

      const differentCwd = makeSession({
        sessionId: 'other-cwd-session',
        cwd: '/projects/other',
      });
      tracker.getState.mockReturnValue({
        sessions: [resumed, differentCwd],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const fullState = lastPosted('state:full');
      const sessionIds = fullState.sessions.map((s: any) => s.sessionId);
      expect(sessionIds).toContain('other-cwd-session');
    });

    it('auto-prunes expired recentResumes entries', () => {
      const resumed = makeSession({ sessionId: 'original-id', cwd: '/projects/myapp' });
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });
      tracker.getGroupMembers.mockReturnValue(['original-id']);

      DashboardPanel.currentPanel!.notifySessionReconnected('original-id');

      // Backdate the entry past the window
      const panel = DashboardPanel.currentPanel as any;
      const entry = panel.recentResumes.get('/projects/myapp');
      entry.timestamp = Date.now() - TIMING.GHOST_CONTINUATION_WINDOW_MS - 1;

      // Trigger postFullState which calls filterGhostContinuations
      tracker.getState.mockReturnValue({
        sessions: [resumed],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      // The entry should have been pruned
      expect(panel.recentResumes.size).toBe(0);
    });
  });

  describe('monitoringScope in state:full', () => {
    it('postFullState includes monitoringScope from sessionTracker', () => {
      const mockScope = '~/.claude/projects/-home-user-myapp/';
      tracker.getMonitoringScope.mockReturnValue(mockScope);
      tracker.getState.mockReturnValue({
        sessions: [],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const stateMsg = lastPosted('state:full');
      expect(stateMsg.monitoringScope).toBe(mockScope);
    });

    it('postFullState includes default monitoringScope when unscoped', () => {
      tracker.getMonitoringScope.mockReturnValue('~/.claude/projects/');
      tracker.getState.mockReturnValue({
        sessions: [],
        activities: [],
        conversation: [],
        toolStats: [],
        tokenSummaries: [],
      });

      DashboardPanel.currentPanel!.postFullState();

      const stateMsg = lastPosted('state:full');
      expect(stateMsg.monitoringScope).toBe('~/.claude/projects/');
    });
  });
});
