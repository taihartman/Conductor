import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock child_process ---
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// --- Mock vscode ---
const mockTerminals: any[] = [];

vi.mock('vscode', () => ({
  window: {
    get terminals() {
      return mockTerminals;
    },
  },
}));

import { ProcessDiscovery } from '../terminal/ProcessDiscovery';

/**
 * Helper to configure mockExecFile responses.
 * Maps command name to a callback that resolves/rejects.
 */
function setupExecFile(
  handlers: Record<string, (args: string[], cb: (err: any, stdout: string) => void) => void>
): void {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], _opts: any, cb: (err: any, stdout: string) => void) => {
      const handler = handlers[cmd];
      if (handler) {
        handler(args, cb);
      } else {
        cb(new Error(`Unexpected command: ${cmd}`), '');
      }
    }
  );
}

/** Create a mock terminal with a given name and shell PID. */
function createMockTerminal(name: string, pid: number | undefined): any {
  return {
    name,
    processId: Promise.resolve(pid),
    dispose: vi.fn(),
  };
}

describe('ProcessDiscovery', () => {
  let discovery: ProcessDiscovery;
  let savedPlatform: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminals.length = 0;
    savedPlatform = process.platform;
    // Default to darwin for most tests
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    discovery = new ProcessDiscovery();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true });
  });

  it('returns empty when no terminals exist', async () => {
    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
  });

  it('returns empty on Windows (platform guard)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockTerminals.push(createMockTerminal('bash', 1000));

    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('matches terminal when command line contains --resume <sessionId>', async () => {
    const terminal = createMockTerminal('bash', 1000);
    mockTerminals.push(terminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '2001\n'),
      ps: (_args, cb) => cb(null, 'claude --resume session-abc\n'),
    });

    const result = await discovery.findSessionOwner('session-abc');
    expect(result.terminal).toBe(terminal);
    expect(result.claudePid).toBe(2001);
  });

  it('matches terminal when command line contains --session-id <sessionId>', async () => {
    const terminal = createMockTerminal('zsh', 1100);
    mockTerminals.push(terminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '3001\n'),
      ps: (_args, cb) => cb(null, 'claude --session-id session-xyz\n'),
    });

    const result = await discovery.findSessionOwner('session-xyz');
    expect(result.terminal).toBe(terminal);
    expect(result.claudePid).toBe(3001);
  });

  it('falls back to CWD match for bare claude processes', async () => {
    const terminal = createMockTerminal('bash', 1000);
    mockTerminals.push(terminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '4001\n'),
      ps: (_args, cb) => cb(null, 'claude\n'),
      lsof: (_args, cb) => cb(null, 'p4001\nn/home/user/project\n'),
    });

    const result = await discovery.findSessionOwner('session-123', '/home/user/project');
    expect(result.terminal).toBe(terminal);
    expect(result.claudePid).toBe(4001);
  });

  it('does not CWD-match when CWDs differ', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '4001\n'),
      ps: (_args, cb) => cb(null, 'claude\n'),
      lsof: (_args, cb) => cb(null, 'p4001\nn/home/user/other-project\n'),
    });

    const result = await discovery.findSessionOwner('session-123', '/home/user/project');
    expect(result).toEqual({});
  });

  it('returns empty when no match found (different session ID)', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '5001\n'),
      ps: (_args, cb) => cb(null, 'claude --resume other-session\n'),
    });

    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
  });

  it('handles pgrep errors gracefully (returns empty)', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => cb(new Error('pgrep failed'), ''),
    });

    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
  });

  it('handles pgrep exit code 1 (no children) gracefully', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => {
        const err = new Error('no children') as NodeJS.ErrnoException;
        err.code = '1';
        cb(err, '');
      },
    });

    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
  });

  it('handles ps errors gracefully (skips that PID)', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '6001\n'),
      ps: (_args, cb) => cb(new Error('ps failed'), ''),
    });

    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
  });

  it('handles lsof errors gracefully (skips CWD match)', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '7001\n'),
      ps: (_args, cb) => cb(null, 'claude\n'),
      lsof: (_args, cb) => cb(new Error('lsof failed'), ''),
    });

    const result = await discovery.findSessionOwner('session-123', '/home/user/project');
    expect(result).toEqual({});
  });

  it('skips Conductor-launched terminals', async () => {
    // Add a Conductor terminal first, then a regular one
    mockTerminals.push(createMockTerminal('Claude (Conductor)', 1000));
    mockTerminals.push(createMockTerminal('Claude (Resumed)', 1100));
    const regularTerminal = createMockTerminal('bash', 1200);
    mockTerminals.push(regularTerminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '8001\n'),
      ps: (_args, cb) => cb(null, 'claude --resume session-abc\n'),
    });

    const result = await discovery.findSessionOwner('session-abc');
    // Should match the regular terminal, not the Conductor ones
    expect(result.terminal).toBe(regularTerminal);
  });

  it('skips terminals with no processId', async () => {
    mockTerminals.push(createMockTerminal('bash', undefined));
    const terminalWithPid = createMockTerminal('zsh', 1300);
    mockTerminals.push(terminalWithPid);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '9001\n'),
      ps: (_args, cb) => cb(null, 'claude --resume session-abc\n'),
    });

    const result = await discovery.findSessionOwner('session-abc');
    expect(result.terminal).toBe(terminalWithPid);
  });

  it('handles multiple child PIDs and matches the correct one', async () => {
    const terminal = createMockTerminal('bash', 1000);
    mockTerminals.push(terminal);

    let psCallCount = 0;
    setupExecFile({
      pgrep: (_args, cb) => cb(null, '2001\n2002\n2003\n'),
      ps: (_args, cb) => {
        psCallCount++;
        if (psCallCount === 1) {
          cb(null, 'vim file.ts\n');
        } else if (psCallCount === 2) {
          cb(null, 'claude --resume target-session\n');
        } else {
          cb(null, 'node server.js\n');
        }
      },
    });

    const result = await discovery.findSessionOwner('target-session');
    expect(result.terminal).toBe(terminal);
    expect(result.claudePid).toBe(2002);
  });

  it('does not match non-claude processes', async () => {
    mockTerminals.push(createMockTerminal('bash', 1000));

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '2001\n'),
      ps: (_args, cb) => cb(null, 'node /path/to/some-claude-like-script\n'),
    });

    // "some-claude-like-script" should NOT match — "claude" isn't a standalone word
    const result = await discovery.findSessionOwner('session-123');
    expect(result).toEqual({});
  });

  it('matches claude with full path', async () => {
    const terminal = createMockTerminal('bash', 1000);
    mockTerminals.push(terminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '2001\n'),
      ps: (_args, cb) => cb(null, '/usr/local/bin/claude --resume session-abc\n'),
    });

    const result = await discovery.findSessionOwner('session-abc');
    expect(result.terminal).toBe(terminal);
  });

  it('normalizes trailing slashes in CWD comparison', async () => {
    const terminal = createMockTerminal('bash', 1000);
    mockTerminals.push(terminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '4001\n'),
      ps: (_args, cb) => cb(null, 'claude\n'),
      lsof: (_args, cb) => cb(null, 'p4001\nn/home/user/project/\n'),
    });

    const result = await discovery.findSessionOwner('session-123', '/home/user/project');
    expect(result.terminal).toBe(terminal);
    expect(result.claudePid).toBe(4001);
  });

  it('works on linux platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const terminal = createMockTerminal('bash', 1000);
    mockTerminals.push(terminal);

    setupExecFile({
      pgrep: (_args, cb) => cb(null, '2001\n'),
      ps: (_args, cb) => cb(null, 'claude --resume session-abc\n'),
    });

    const result = await discovery.findSessionOwner('session-abc');
    expect(result.terminal).toBe(terminal);
  });
});
