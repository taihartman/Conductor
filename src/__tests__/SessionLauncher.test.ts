import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// UUID v4 regex pattern for assertions
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- Mock node-pty ---
let mockPtyDataCallback: ((data: string) => void) | undefined;
let mockPtyExitCallback: ((e: { exitCode: number }) => void) | undefined;

const mockPtyProcess = {
  pid: 12345,
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn((cb: (data: string) => void) => {
    mockPtyDataCallback = cb;
    return { dispose: vi.fn() };
  }),
  onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
    mockPtyExitCallback = cb;
    return { dispose: vi.fn() };
  }),
};

let nodePtyAvailable = true;

vi.mock('node-pty', () => {
  // The module factory is evaluated once. The spawn function checks the flag at call time.
  // For fallback tests we need the import itself to fail, which we handle by
  // overriding the module's default export check (spawn still exists, but we test fallback
  // by making a fresh launcher instance that encounters a spawn failure on first use).
  return {
    spawn: vi.fn(() => {
      if (!nodePtyAvailable) {
        throw new Error('node-pty not available');
      }
      return mockPtyProcess;
    }),
  };
});

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
        pty: opts.pty,
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
import type { IProcessDiscovery, ProcessOwnerResult } from '../terminal/IProcessDiscovery';

function createMockOutputChannel(): any {
  return { appendLine: vi.fn(), dispose: vi.fn() };
}

function createMockProcessDiscovery(result: ProcessOwnerResult = {}): IProcessDiscovery {
  return {
    findSessionOwner: vi.fn().mockResolvedValue(result),
  };
}

describe('SessionLauncher', () => {
  let launcher: SessionLauncher;
  let outputChannel: any;
  let savedClaudeCode: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminals.length = 0;
    terminalCloseCallback = undefined;
    mockPtyDataCallback = undefined;
    mockPtyExitCallback = undefined;
    nodePtyAvailable = true;
    // Disable nested-session guard so tests can run inside Claude Code
    savedClaudeCode = process.env.CLAUDECODE;
    delete process.env.CLAUDECODE;
    outputChannel = createMockOutputChannel();
    launcher = new SessionLauncher(outputChannel);
  });

  afterEach(() => {
    launcher.dispose();
    // Restore env
    if (savedClaudeCode !== undefined) {
      process.env.CLAUDECODE = savedClaudeCode;
    }
  });

  describe('launch (node-pty mode)', () => {
    it('returns a UUID session ID', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(sessionId).toMatch(UUID_V4_REGEX);
    });

    it('calls pty.spawn with correct args', async () => {
      const nodePty = await import('node-pty');
      const sessionId = await launcher.launch('/test/workspace');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--session-id', sessionId],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: '/test/workspace',
        })
      );
    });

    it('spawned env includes FORCE_COLOR', async () => {
      const nodePty = await import('node-pty');
      await launcher.launch('/test/workspace');
      const callArgs = vi.mocked(nodePty.spawn).mock.calls[0][2]!;
      expect(callArgs.env).toEqual(expect.objectContaining({ FORCE_COLOR: '1' }));
    });

    it('marks the session as launched', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(launcher.isLaunchedSession(sessionId)).toBe(true);
    });

    it('creates VS Code terminal with pty (not shellPath)', async () => {
      await launcher.launch('/test/workspace');
      expect(mockTerminals.length).toBe(1);
      expect(mockTerminals[0].pty).toBeDefined();
      expect(mockTerminals[0].shellPath).toBeUndefined();
    });

    it('creates terminal but does not auto-show it', async () => {
      await launcher.launch('/test/workspace');
      expect(mockTerminals[0].show).not.toHaveBeenCalled();
    });

    it('fires onPtyData when pty emits data', async () => {
      const dataEvents: { sessionId: string; data: string }[] = [];
      launcher.onPtyData((e) => dataEvents.push(e));

      const sessionId = await launcher.launch('/test/workspace');
      mockPtyDataCallback?.('hello output');

      expect(dataEvents).toHaveLength(1);
      expect(dataEvents[0]).toEqual({ sessionId, data: 'hello output' });
    });

    it('fires onSessionExit when pty process exits', async () => {
      const exitEvents: { sessionId: string; code: number | null }[] = [];
      launcher.onSessionExit((e) => exitEvents.push(e));

      const sessionId = await launcher.launch('/test/workspace');
      mockPtyExitCallback?.({ exitCode: 0 });

      expect(exitEvents).toHaveLength(1);
      expect(exitEvents[0]).toEqual({ sessionId, code: 0 });
      expect(launcher.isLaunchedSession(sessionId)).toBe(false);
    });

    it('kills pty when user closes terminal tab', async () => {
      await launcher.launch('/test/workspace');
      const terminal = mockTerminals[0];

      terminalCloseCallback?.(terminal);
      expect(mockPtyProcess.kill).toHaveBeenCalled();
    });

    it('calls preSpawnCallback before pty.spawn', async () => {
      const callOrder: string[] = [];
      const nodePty = await import('node-pty');

      vi.mocked(nodePty.spawn).mockImplementation((..._args: any[]) => {
        callOrder.push('spawn');
        return mockPtyProcess as any;
      });

      launcher.setPreSpawnCallback(() => {
        callOrder.push('preSpawn');
      });

      await launcher.launch('/test/workspace');
      expect(callOrder).toEqual(['preSpawn', 'spawn']);
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
  });

  describe('resume (node-pty mode)', () => {
    it('calls pty.spawn with --resume and --print args', async () => {
      const nodePty = await import('node-pty');
      await launcher.resume('session-abc', 'hello world', '/test/workspace');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--resume', 'session-abc', '--print', 'hello world'],
        expect.objectContaining({
          cwd: '/test/workspace',
        })
      );
    });

    it('calls pty.spawn with --resume only when text is empty', async () => {
      const nodePty = await import('node-pty');
      await launcher.resume('session-abc', '', '/test/workspace');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--resume', 'session-abc'],
        expect.objectContaining({
          cwd: '/test/workspace',
        })
      );
    });

    it('registers session so isLaunchedSession returns true', async () => {
      expect(launcher.isLaunchedSession('session-abc')).toBe(false);
      await launcher.resume('session-abc', 'hi');
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);
    });

    it('skips duplicate resume when session already has a terminal', async () => {
      const nodePty = await import('node-pty');
      await launcher.resume('session-abc', '', '/test/workspace');
      expect(nodePty.spawn).toHaveBeenCalledTimes(1);
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);

      // Second resume for the same session — should be a no-op
      await launcher.resume('session-abc', 'hello', '/test/workspace');
      expect(nodePty.spawn).toHaveBeenCalledTimes(1); // NOT 2
    });
  });

  describe('writeInput (node-pty mode)', () => {
    it('writes directly to ptyProcess.write', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      launcher.writeInput(sessionId, 'test input');
      expect(mockPtyProcess.write).toHaveBeenCalledWith('test input');
    });

    it('does nothing for unknown session IDs', () => {
      launcher.writeInput('unknown-session', 'test');
      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });
  });

  describe('resize (node-pty mode)', () => {
    it('calls ptyProcess.resize', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      launcher.resize(sessionId, 80, 24);
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(80, 24);
    });
  });

  describe('fallback to shellPath', () => {
    beforeEach(() => {
      // Force re-creation and pre-cache node-pty as null to trigger shellPath fallback
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel);
      // Set the cached module to null so loadNodePty returns null immediately
      (launcher as any).nodePtyModule = null;
    });

    it('creates terminal with shellPath when node-pty unavailable', async () => {
      await launcher.launch('/test/workspace');
      expect(mockTerminals.length).toBe(1);
      expect(mockTerminals[0].shellPath).toBe('claude');
      expect(mockTerminals[0].pty).toBeUndefined();
    });

    it('writeInput falls back to sendText', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      launcher.writeInput(sessionId, 'test');
      expect(mockTerminals[0].sendText).toHaveBeenCalledWith('test', false);
    });

    it('resize is a no-op in fallback mode', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      // Should not throw
      launcher.resize(sessionId, 80, 24);
    });

    it('fires onSessionExit when terminal closes', async () => {
      const exitEvents: { sessionId: string; code: number | null }[] = [];
      launcher.onSessionExit((e) => exitEvents.push(e));

      const sessionId = await launcher.launch('/test/workspace');
      const terminal = mockTerminals[0];
      terminal.exitStatus = { code: 0 };
      terminalCloseCallback?.(terminal);

      expect(exitEvents).toHaveLength(1);
      expect(exitEvents[0]).toEqual({ sessionId, code: 0 });
      expect(launcher.isLaunchedSession(sessionId)).toBe(false);
    });
  });

  describe('dispose', () => {
    it('kills pty processes and disposes terminals', async () => {
      const sessionId = await launcher.launch('/test/workspace');
      expect(launcher.isLaunchedSession(sessionId)).toBe(true);

      launcher.dispose();
      expect(mockPtyProcess.kill).toHaveBeenCalled();
      expect(mockTerminals[0].dispose).toHaveBeenCalled();
      expect(launcher.isLaunchedSession(sessionId)).toBe(false);
    });
  });

  describe('isLaunchedSession', () => {
    it('returns false for unknown sessions', () => {
      expect(launcher.isLaunchedSession('unknown')).toBe(false);
    });
  });

  describe('transfer', () => {
    it('falls back to resume when no process discovery provided', async () => {
      // Default launcher has no processDiscovery
      await launcher.transfer('session-abc', 'hello', '/test/workspace');
      // Should have created a terminal (via resume path)
      expect(mockTerminals.length).toBe(1);
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);
    });

    it('falls back to resume when no terminal match found', async () => {
      const discovery = createMockProcessDiscovery({});
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      await launcher.transfer('session-abc', 'hello', '/test/workspace');
      expect(discovery.findSessionOwner).toHaveBeenCalledWith('session-abc', '/test/workspace');
      expect(mockTerminals.length).toBe(1);
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);
    });

    it('closes terminal and resumes when terminal match found', async () => {
      const externalTerminal = {
        name: 'bash',
        dispose: vi.fn(),
      };
      const discovery = createMockProcessDiscovery({
        terminal: externalTerminal as any,
        claudePid: 9999,
      });
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      await launcher.transfer('session-abc', 'hello', '/test/workspace');

      // External terminal should have been disposed
      expect(externalTerminal.dispose).toHaveBeenCalled();
      // Should have spawned a new terminal via resume
      expect(mockTerminals.length).toBe(1);
      expect(launcher.isLaunchedSession('session-abc')).toBe(true);
    });

    it('calls terminal.dispose() before resume', async () => {
      const callOrder: string[] = [];
      const externalTerminal = {
        name: 'bash',
        dispose: vi.fn(() => callOrder.push('dispose')),
      };
      const discovery = createMockProcessDiscovery({
        terminal: externalTerminal as any,
        claudePid: 8888,
      });
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      const nodePty = await import('node-pty');
      vi.mocked(nodePty.spawn).mockImplementationOnce((..._args: any[]) => {
        callOrder.push('spawn');
        return mockPtyProcess as any;
      });

      await launcher.transfer('session-abc', '', '/test/workspace');

      expect(callOrder.indexOf('dispose')).toBeLessThan(callOrder.indexOf('spawn'));
    });

    it('logs recovery message when resume fails after terminal close', async () => {
      const externalTerminal = {
        name: 'bash',
        dispose: vi.fn(),
      };
      const discovery = createMockProcessDiscovery({
        terminal: externalTerminal as any,
        claudePid: 7777,
      });
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      const nodePty = await import('node-pty');
      // Use mockImplementationOnce to avoid leaking the throw into subsequent tests
      vi.mocked(nodePty.spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await expect(launcher.transfer('session-abc', 'hello', '/test/workspace')).rejects.toThrow(
        'spawn failed'
      );

      // Should still have disposed the external terminal
      expect(externalTerminal.dispose).toHaveBeenCalled();
      // Should log recovery info
      expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('session-abc'));
    });

    it('passes sessionId and cwd to processDiscovery.findSessionOwner', async () => {
      const discovery = createMockProcessDiscovery({});
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      await launcher.transfer('session-xyz', 'msg', '/my/project');
      expect(discovery.findSessionOwner).toHaveBeenCalledWith('session-xyz', '/my/project');
    });

    it('returns the sessionId when no process discovery provided', async () => {
      const result = await launcher.transfer('session-abc', 'hello', '/test/workspace');
      expect(result).toBe('session-abc');
    });

    it('returns the sessionId when no terminal match found', async () => {
      const discovery = createMockProcessDiscovery({});
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      const result = await launcher.transfer('session-abc', 'hello', '/test/workspace');
      expect(result).toBe('session-abc');
    });

    it('returns the sessionId when terminal match found (no searchIds)', async () => {
      const externalTerminal = { name: 'bash', dispose: vi.fn() };
      const discovery = createMockProcessDiscovery({
        terminal: externalTerminal as any,
        claudePid: 9999,
      });
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel, discovery);

      const result = await launcher.transfer('session-abc', 'hello', '/test/workspace');
      expect(result).toBe('session-abc');
    });

    describe('with searchIds', () => {
      it('finds terminal on 2nd member and resumes with matched ID', async () => {
        const externalTerminal = { name: 'bash', dispose: vi.fn() };
        const discovery: IProcessDiscovery = {
          findSessionOwner: vi
            .fn()
            .mockResolvedValueOnce({}) // 1st ID — no match
            .mockResolvedValueOnce({ terminal: externalTerminal, claudePid: 5555 }), // 2nd ID — match
        };
        launcher.dispose();
        launcher = new SessionLauncher(outputChannel, discovery);

        const result = await launcher.transfer('primary-id', 'msg', '/test/workspace', [
          'member-a',
          'member-b',
          'member-c',
        ]);

        // Should have searched member-a then member-b
        expect(discovery.findSessionOwner).toHaveBeenCalledTimes(2);
        expect(discovery.findSessionOwner).toHaveBeenNthCalledWith(
          1,
          'member-a',
          '/test/workspace'
        );
        expect(discovery.findSessionOwner).toHaveBeenNthCalledWith(
          2,
          'member-b',
          '/test/workspace'
        );

        // Should have closed external terminal
        expect(externalTerminal.dispose).toHaveBeenCalled();

        // Should have resumed with matched ID (member-b), not primary-id
        expect(launcher.isLaunchedSession('member-b')).toBe(true);
        expect(result).toBe('member-b');
      });

      it('falls back to sessionId when no searchIds match', async () => {
        const discovery: IProcessDiscovery = {
          findSessionOwner: vi.fn().mockResolvedValue({}),
        };
        launcher.dispose();
        launcher = new SessionLauncher(outputChannel, discovery);

        const result = await launcher.transfer('primary-id', 'msg', '/test/workspace', [
          'member-a',
          'member-b',
        ]);

        // Should have searched all members
        expect(discovery.findSessionOwner).toHaveBeenCalledTimes(2);

        // Should fall back to resume with primary-id
        expect(launcher.isLaunchedSession('primary-id')).toBe(true);
        expect(result).toBe('primary-id');
      });

      it('returns resumed ID (not the sessionId param)', async () => {
        const externalTerminal = { name: 'bash', dispose: vi.fn() };
        const discovery: IProcessDiscovery = {
          findSessionOwner: vi
            .fn()
            .mockResolvedValueOnce({ terminal: externalTerminal, claudePid: 1111 }),
        };
        launcher.dispose();
        launcher = new SessionLauncher(outputChannel, discovery);

        const result = await launcher.transfer('fallback-id', 'msg', '/test/workspace', [
          'matched-id',
        ]);

        expect(result).toBe('matched-id');
        expect(launcher.isLaunchedSession('matched-id')).toBe(true);
      });

      it('without searchIds behaves identically to before', async () => {
        const externalTerminal = { name: 'bash', dispose: vi.fn() };
        const discovery = createMockProcessDiscovery({
          terminal: externalTerminal as any,
          claudePid: 2222,
        });
        launcher.dispose();
        launcher = new SessionLauncher(outputChannel, discovery);

        const result = await launcher.transfer('session-abc', 'hello', '/test/workspace');

        // Should search for session-abc (the sessionId)
        expect(discovery.findSessionOwner).toHaveBeenCalledWith('session-abc', '/test/workspace');
        expect(externalTerminal.dispose).toHaveBeenCalled();
        expect(launcher.isLaunchedSession('session-abc')).toBe(true);
        expect(result).toBe('session-abc');
      });
    });
  });

  describe('env isolation', () => {
    it('node-pty mode does not pass CLAUDECODE env vars', async () => {
      // Save originals for cleanup
      const savedSsePort = process.env.CLAUDE_CODE_SSE_PORT;
      const savedEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;

      // Set env vars that buildCleanEnv() should strip
      // (CLAUDECODE is already deleted by the outer beforeEach)
      process.env.CLAUDE_CODE_SSE_PORT = '3000';
      process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';

      launcher.dispose();
      launcher = new SessionLauncher(outputChannel);

      const nodePty = await import('node-pty');
      await launcher.launch('/test/workspace');

      const callArgs = vi.mocked(nodePty.spawn).mock.calls[0][2]!;
      const env = callArgs.env as Record<string, string>;
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.CLAUDE_CODE_SSE_PORT).toBeUndefined();
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
      expect(env.FORCE_COLOR).toBe('1');

      // Cleanup
      delete process.env.CLAUDE_CODE_SSE_PORT;
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      if (savedSsePort !== undefined) process.env.CLAUDE_CODE_SSE_PORT = savedSsePort;
      if (savedEntrypoint !== undefined) process.env.CLAUDE_CODE_ENTRYPOINT = savedEntrypoint;
    });

    it('shellPath mode sets CLAUDECODE env vars to empty string', async () => {
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel);
      (launcher as any).nodePtyModule = null;

      await launcher.launch('/test/workspace');
      const termOpts = vi.mocked(vscode.window.createTerminal).mock.calls[0][0] as any;
      expect(termOpts.env.CLAUDECODE).toBe('');
      expect(termOpts.env.CLAUDE_CODE_SSE_PORT).toBe('');
      expect(termOpts.env.CLAUDE_CODE_ENTRYPOINT).toBe('');
      expect(termOpts.env.FORCE_COLOR).toBe('1');
    });
  });

  describe('launch modes', () => {
    it('launch with normal mode passes standard args (same as no mode)', async () => {
      const nodePty = await import('node-pty');
      const sessionId = await launcher.launch('/test/workspace', 'normal');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--session-id', sessionId],
        expect.objectContaining({ cwd: '/test/workspace' })
      );
    });

    it('launch with no mode defaults to normal args', async () => {
      const nodePty = await import('node-pty');
      const sessionId = await launcher.launch('/test/workspace');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--session-id', sessionId],
        expect.objectContaining({ cwd: '/test/workspace' })
      );
    });

    it('launch with yolo mode includes --dangerously-skip-permissions', async () => {
      const nodePty = await import('node-pty');
      const sessionId = await launcher.launch('/test/workspace', 'yolo');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--session-id', sessionId, '--dangerously-skip-permissions'],
        expect.objectContaining({ cwd: '/test/workspace' })
      );
    });

    it('launch with yolo mode still returns a valid UUID', async () => {
      const sessionId = await launcher.launch('/test/workspace', 'yolo');
      expect(sessionId).toMatch(UUID_V4_REGEX);
    });

    it('launch with remote mode throws not-yet-supported error', async () => {
      await expect(launcher.launch('/test/workspace', 'remote')).rejects.toThrow(
        /remote.*not.*supported/i
      );
    });

    it('yolo mode in shellPath fallback includes --dangerously-skip-permissions', async () => {
      launcher.dispose();
      launcher = new SessionLauncher(outputChannel);
      (launcher as any).nodePtyModule = null;

      const sessionId = await launcher.launch('/test/workspace', 'yolo');
      expect(mockTerminals.length).toBe(1);
      expect(mockTerminals[0].shellArgs).toEqual(
        expect.arrayContaining(['--dangerously-skip-permissions'])
      );
      expect(mockTerminals[0].shellArgs).toEqual(
        expect.arrayContaining(['--session-id', sessionId])
      );
    });
  });
});
