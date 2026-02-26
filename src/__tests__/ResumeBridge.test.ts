import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ResumeBridge } from '../terminal/ResumeBridge';
import { RESUME } from '../constants';

type MockChild = EventEmitter & { killed: boolean; kill: ReturnType<typeof vi.fn> };

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
  });
  return child;
}

/** Records of each spawn call, including the mock child returned. */
let spawnCalls: Array<{ command: string; args: string[]; options: any; child: MockChild }>;

vi.mock('child_process', () => ({
  spawn: vi.fn((...args: any[]) => {
    const child = createMockChild();
    spawnCalls.push({ command: args[0], args: args[1], options: args[2], child });
    return child;
  }),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
    workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
  },
}));

function createMockOutputChannel(): any {
  return {
    appendLine: vi.fn(),
    dispose: vi.fn(),
  };
}

/**
 * Flush the microtask queue so that `.then()` callbacks (like doSend inside
 * the serial queue) execute before we emit events on mock children.
 */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('ResumeBridge', () => {
  let bridge: ResumeBridge;
  let outputChannel: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    spawnCalls = [];
    outputChannel = createMockOutputChannel();
    bridge = new ResumeBridge(outputChannel);
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  describe('sendInput — happy path', () => {
    it('returns sent when spawn succeeds', async () => {
      const promise = bridge.sendInput('session-1', 'hello world');
      await flushMicrotasks();

      expect(spawnCalls).toHaveLength(1);
      spawnCalls[0].child.emit('spawn');

      const result = await promise;
      expect(result).toBe('sent');
    });

    it('passes correct args to spawn', async () => {
      const promise = bridge.sendInput('session-abc', 'test message');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      expect(spawnCalls[0].command).toBe('claude');
      expect(spawnCalls[0].args).toEqual(['--resume', 'session-abc', '--print', 'test message']);
    });

    it('uses shell: false to prevent command injection', async () => {
      const promise = bridge.sendInput('s-1', 'text');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      expect(spawnCalls[0].options.shell).toBe(false);
    });

    it('sets CLAUDECODE to empty string in env', async () => {
      const promise = bridge.sendInput('s-1', 'text');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      expect(spawnCalls[0].options.env.CLAUDECODE).toBe('');
    });

    it('sets stdio to ignore', async () => {
      const promise = bridge.sendInput('s-1', 'text');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      expect(spawnCalls[0].options.stdio).toBe('ignore');
    });

    it('sets cwd to workspace folder', async () => {
      const promise = bridge.sendInput('s-1', 'text');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      expect(spawnCalls[0].options.cwd).toBe('/test/workspace');
    });
  });

  describe('sendInput — spawn error', () => {
    it('returns error when spawn fails (ENOENT)', async () => {
      const promise = bridge.sendInput('session-1', 'hello');
      await flushMicrotasks();

      const err = new Error('spawn claude ENOENT');
      (err as any).code = 'ENOENT';
      spawnCalls[0].child.emit('error', err);

      const result = await promise;
      expect(result).toBe('error');
    });

    it('logs error to output channel on spawn failure', async () => {
      const promise = bridge.sendInput('session-1', 'hello');
      await flushMicrotasks();

      spawnCalls[0].child.emit('error', new Error('spawn claude ENOENT'));
      await promise;

      expect(outputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Failed to spawn claude')
      );
    });
  });

  describe('hasTerminal', () => {
    it('always returns true for any session ID', () => {
      expect(bridge.hasTerminal('session-1')).toBe(true);
      expect(bridge.hasTerminal('nonexistent')).toBe(true);
      expect(bridge.hasTerminal('')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('returns error after dispose', async () => {
      bridge.dispose();
      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('error');
    });
  });

  describe('serial queue', () => {
    it('queues sends to the same session sequentially', async () => {
      const promise1 = bridge.sendInput('session-1', 'first');
      const promise2 = bridge.sendInput('session-1', 'second');
      await flushMicrotasks();

      // Only one spawn call should exist — second is queued behind the first
      expect(spawnCalls).toHaveLength(1);

      // Complete the first send
      spawnCalls[0].child.emit('spawn');
      await promise1;

      // Flush so the queued second send starts
      await flushMicrotasks();
      expect(spawnCalls).toHaveLength(2);

      spawnCalls[1].child.emit('spawn');
      const result2 = await promise2;
      expect(result2).toBe('sent');
    });

    it('allows concurrent sends to different sessions', async () => {
      const promise1 = bridge.sendInput('session-1', 'first');
      const promise2 = bridge.sendInput('session-2', 'second');
      await flushMicrotasks();

      // Both should spawn immediately (different sessions)
      expect(spawnCalls).toHaveLength(2);

      spawnCalls[0].child.emit('spawn');
      spawnCalls[1].child.emit('spawn');

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toBe('sent');
      expect(result2).toBe('sent');
    });
  });

  describe('timeout', () => {
    it('kills the process after TIMEOUT_MS', async () => {
      const promise = bridge.sendInput('session-1', 'hello');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      expect(spawnCalls[0].child.killed).toBe(false);

      vi.advanceTimersByTime(RESUME.TIMEOUT_MS);

      expect(spawnCalls[0].child.kill).toHaveBeenCalled();
    });

    it('does not kill an already-killed process', async () => {
      const promise = bridge.sendInput('session-1', 'hello');
      await flushMicrotasks();

      spawnCalls[0].child.emit('spawn');
      await promise;

      // Simulate process exiting on its own
      spawnCalls[0].child.killed = true;

      vi.advanceTimersByTime(RESUME.TIMEOUT_MS);

      // kill() should not be called since .killed is already true
      expect(spawnCalls[0].child.kill).not.toHaveBeenCalled();
    });
  });
});
