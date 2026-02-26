import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock vscode ---
let messageHandler: ((msg: any) => void) | undefined;
const postedMessages: any[] = [];

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
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
    activeTextEditor: undefined,
  },
  ViewColumn: { One: 1 },
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
  return {
    onOrderChanged: vi.fn(() => ({ dispose: vi.fn() })),
    getOrder: vi.fn(() => []),
    setOrder: vi.fn(() => Promise.resolve()),
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
    dispose: vi.fn(),
  };
}

function createMockPtyBridge(): any {
  return {
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    pushData: vi.fn(),
  };
}

function createMockContext(): any {
  return {
    extensionUri: { fsPath: '/ext', scheme: 'file', path: '/ext' },
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
      ptyBridge
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

      expect(launcher.writeInput).toHaveBeenCalledWith('session-abc', 'hello\n');
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

      expect(launcher.writeInput).toHaveBeenCalledWith('cont-1', 'hello\n');
      const status = lastPosted('user:input-status');
      expect(status.status).toBe('sent');
    });
  });

  describe('user:send-input — Path C (adoption)', () => {
    it('posts adopting then sent on successful adoption', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.isLaunchedSession.mockReturnValue(false);

      const resumePromise = Promise.resolve();
      launcher.resume.mockReturnValue(resumePromise);

      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'hi' });

      // Should have posted 'adopting' immediately
      const adopting = postedMessages.find(
        (m) => m.type === 'user:input-status' && m.status === 'adopting'
      );
      expect(adopting).toBeDefined();
      expect(adopting.sessionId).toBe('ext-session');

      // Wait for resume to complete
      await resumePromise;
      // Flush microtask queue for .then()
      await vi.waitFor(() => {
        const sent = postedMessages.find(
          (m) => m.type === 'user:input-status' && m.status === 'sent'
        );
        expect(sent).toBeDefined();
      });

      expect(launcher.resume).toHaveBeenCalledWith('ext-session', 'hi', undefined);
      expect(ptyBridge.registerSession).toHaveBeenCalledWith('ext-session');
    });

    it('posts error on adoption failure', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.isLaunchedSession.mockReturnValue(false);

      const resumePromise = Promise.reject(new Error('spawn failed'));
      launcher.resume.mockReturnValue(resumePromise);

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
      launcher.resume.mockReturnValue(new Promise(() => {}));

      // First send — triggers adoption
      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'first' });
      expect(launcher.resume).toHaveBeenCalledTimes(1);

      // Second send — same session, should be deduped
      sendMessage({ type: 'user:send-input', sessionId: 'ext-session', text: 'second' });
      expect(launcher.resume).toHaveBeenCalledTimes(1); // NOT 2

      const sentMessages = postedMessages.filter(
        (m) => m.type === 'user:input-status' && m.status === 'sent'
      );
      expect(sentMessages).toHaveLength(1); // dedup guard posts 'sent' for second msg
    });
  });

  describe('session:adopt', () => {
    it('posts adopted status on success', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.resume.mockResolvedValue(undefined);

      sendMessage({ type: 'session:adopt', sessionId: 'ext-session' });

      await vi.waitFor(() => {
        const adopted = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'adopted'
        );
        expect(adopted).toBeDefined();
        expect(adopted.sessionId).toBe('ext-session');
      });

      expect(ptyBridge.registerSession).toHaveBeenCalledWith('ext-session');
    });

    it('posts error status on failure', async () => {
      tracker.getMostRecentContinuationMember.mockReturnValue('ext-session');
      tracker.getGroupMembers.mockReturnValue(['ext-session']);
      launcher.resume.mockRejectedValue(new Error('no claude'));

      sendMessage({ type: 'session:adopt', sessionId: 'ext-session' });

      await vi.waitFor(() => {
        const error = postedMessages.find(
          (m) => m.type === 'session:adopt-status' && m.status === 'error'
        );
        expect(error).toBeDefined();
        expect(error.error).toContain('no claude');
      });
    });
  });
});
