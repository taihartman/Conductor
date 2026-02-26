import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// UUID v4 regex pattern for assertions
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- Mock vscode ---
let terminalCloseCallback: ((terminal: any) => void) | undefined;
const mockTerminals: any[] = [];

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    })),
  },
  window: {
    createTerminal: vi.fn((opts: any) => {
      const term = {
        name: opts.name,
        shellPath: opts.shellPath,
        shellArgs: opts.shellArgs,
        dispose: vi.fn(),
        show: vi.fn(),
        sendText: vi.fn(),
        exitStatus: undefined as { code: number | undefined } | undefined,
      };
      mockTerminals.push(term);
      return term;
    }),
    onDidCloseTerminal: vi.fn((callback: (terminal: any) => void) => {
      terminalCloseCallback = callback;
      return { dispose: vi.fn() };
    }),
    showOpenDialog: vi.fn(),
  },
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

import * as vscode from 'vscode';
import { SessionLauncher } from '../terminal/SessionLauncher';

function createMockOutputChannel(): any {
  return { appendLine: vi.fn(), dispose: vi.fn() };
}

describe('SessionLauncher', () => {
  let launcher: SessionLauncher;
  let outputChannel: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminals.length = 0;
    terminalCloseCallback = undefined;
    outputChannel = createMockOutputChannel();
    launcher = new SessionLauncher(outputChannel);
  });

  afterEach(() => {
    launcher.dispose();
  });

  describe('launch', () => {
    it('returns a UUID session ID', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(sessionId).toMatch(UUID_V4_REGEX);
    });

    it('creates a terminal with shellPath and --session-id args', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          shellPath: 'claude',
          shellArgs: ['--session-id', sessionId],
          cwd: '/test/workspace',
        })
      );
    });

    it('marks the session as launched', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(launcher.isLaunchedSession(sessionId)).toBe(true);
    });

    it('creates a VS Code terminal with correct name', async () => {
      await launcher.launch('/test/workspace');
      expect(mockTerminals.length).toBe(1);
      expect(mockTerminals[0].name).toBe('Claude (Conductor)');
    });

    it('shows the terminal without stealing focus', async () => {
      await launcher.launch('/test/workspace');
      expect(mockTerminals[0].show).toHaveBeenCalledWith(false);
    });

    it('fires onSessionExit and cleans up when terminal closes', async () => {
      const exitEvents: { sessionId: string; code: number | null }[] = [];
      launcher.onSessionExit((e) => exitEvents.push(e));

      const sessionId = await launcher.launch('/test/workspace');
      expect(launcher.isLaunchedSession(sessionId)).toBe(true);

      // Simulate terminal close with exit code
      const terminal = mockTerminals[0];
      terminal.exitStatus = { code: 0 };
      terminalCloseCallback?.(terminal);

      expect(exitEvents).toHaveLength(1);
      expect(exitEvents[0]).toEqual({ sessionId, code: 0 });
      expect(launcher.isLaunchedSession(sessionId)).toBe(false);
    });

    it('reports null code when terminal has no exit status', async () => {
      const exitEvents: { sessionId: string; code: number | null }[] = [];
      launcher.onSessionExit((e) => exitEvents.push(e));

      await launcher.launch('/test/workspace');

      const terminal = mockTerminals[0];
      terminal.exitStatus = undefined;
      terminalCloseCallback?.(terminal);

      expect(exitEvents[0].code).toBeNull();
    });

    it('throws when no workspace folder and user cancels folder picker', async () => {
      const origFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;
      vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

      await expect(launcher.launch()).rejects.toThrow('No folder selected');

      (vscode.workspace as any).workspaceFolders = origFolders;
    });

    it('skips folder picker when cwd is provided', async () => {
      const origFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;

      const sessionId = await launcher.launch('/explicit/path');
      expect(sessionId).toMatch(UUID_V4_REGEX);
      expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();

      (vscode.workspace as any).workspaceFolders = origFolders;
    });

    it('skips folder picker when workspace folder exists', async () => {
      const sessionId = await launcher.launch();
      expect(sessionId).toMatch(UUID_V4_REGEX);
      expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();
    });

    it('shows folder picker and launches when user selects folder', async () => {
      const origFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;
      vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
        { fsPath: '/picked/folder' },
      ] as any);

      const sessionId = await launcher.launch();
      expect(sessionId).toMatch(UUID_V4_REGEX);
      expect(vscode.window.showOpenDialog).toHaveBeenCalled();

      (vscode.workspace as any).workspaceFolders = origFolders;
    });
  });

  describe('resume', () => {
    it('creates terminal with --resume and --print args when text is provided', async () => {
      await launcher.resume('session-abc', 'hello world', '/test/workspace');
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          shellPath: 'claude',
          shellArgs: ['--resume', 'session-abc', '--print', 'hello world'],
          cwd: '/test/workspace',
        })
      );
    });

    it('creates terminal with --resume only when text is empty (adopt-only)', async () => {
      await launcher.resume('session-abc', '', '/test/workspace');
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          shellPath: 'claude',
          shellArgs: ['--resume', 'session-abc'],
          cwd: '/test/workspace',
        })
      );
    });

    it('registers session so isLaunchedSession returns true', async () => {
      expect(launcher.isLaunchedSession('session-abc')).toBe(false);
      await launcher.resume('session-abc', 'hi');
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);
    });

    it('uses provided cwd', async () => {
      await launcher.resume('session-abc', 'hi', '/custom/dir');
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/custom/dir' })
      );
    });

    it('falls back to workspace root when cwd is undefined', async () => {
      await launcher.resume('session-abc', 'hi');
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/test/workspace' })
      );
    });

    it('omits cwd when no workspace folder and no cwd provided', async () => {
      const origFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;

      await launcher.resume('session-abc', 'hi');
      const callArg = vi.mocked(vscode.window.createTerminal).mock.calls[0][0] as any;
      expect(callArg.cwd).toBeUndefined();

      (vscode.workspace as any).workspaceFolders = origFolders;
    });

    it('uses PTY.RESUMED_TERMINAL_NAME as terminal name', async () => {
      await launcher.resume('session-abc', 'hi');
      expect(mockTerminals[0].name).toBe('Claude (Resumed)');
    });

    it('shows the terminal without stealing focus', async () => {
      await launcher.resume('session-abc', 'hi');
      expect(mockTerminals[0].show).toHaveBeenCalledWith(false);
    });

    it('fires onSessionExit and cleans up when terminal closes', async () => {
      const exitEvents: { sessionId: string; code: number | null }[] = [];
      launcher.onSessionExit((e) => exitEvents.push(e));

      await launcher.resume('session-abc', 'hi');
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);

      const terminal = mockTerminals[0];
      terminal.exitStatus = { code: 1 };
      terminalCloseCallback?.(terminal);

      expect(exitEvents).toHaveLength(1);
      expect(exitEvents[0]).toEqual({ sessionId: 'session-abc', code: 1 });
      expect(launcher.isLaunchedSession('session-abc')).toBe(false);
    });
  });

  describe('writeInput', () => {
    it('sends text to the terminal without appending newline', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      launcher.writeInput(sessionId, 'test input');
      expect(mockTerminals[0].sendText).toHaveBeenCalledWith('test input', false);
    });

    it('does nothing for unknown session IDs', () => {
      launcher.writeInput('unknown-session', 'test');
      // No terminal exists, so sendText should not be called
      expect(mockTerminals.length).toBe(0);
    });
  });

  describe('isLaunchedSession', () => {
    it('returns false for unknown sessions', () => {
      expect(launcher.isLaunchedSession('unknown')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('disposes all terminals and cleans up sessions', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(launcher.isLaunchedSession(sessionId)).toBe(true);

      launcher.dispose();
      expect(mockTerminals[0].dispose).toHaveBeenCalled();
      expect(launcher.isLaunchedSession(sessionId)).toBe(false);
    });
  });
});
