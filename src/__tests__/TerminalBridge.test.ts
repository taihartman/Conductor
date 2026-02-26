import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalBridge } from '../terminal/TerminalBridge';

// Track the close listener callback so tests can simulate terminal close events
let closeListenerCallback: ((terminal: any) => void) | undefined;

vi.mock('vscode', () => {
  return {
    window: {
      terminals: [] as any[],
      showQuickPick: vi.fn(),
      showInformationMessage: vi.fn(),
      onDidCloseTerminal: vi.fn((callback: (terminal: any) => void) => {
        closeListenerCallback = callback;
        return { dispose: vi.fn() };
      }),
    },
  };
});

import * as vscode from 'vscode';

function createMockTerminal(name: string, exited = false): any {
  return {
    name,
    exitStatus: exited ? { code: 0 } : undefined,
    sendText: vi.fn(),
  };
}

function createMockOutputChannel(): any {
  return {
    appendLine: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('TerminalBridge', () => {
  let bridge: TerminalBridge;
  let outputChannel: any;

  beforeEach(() => {
    vi.clearAllMocks();
    closeListenerCallback = undefined;
    outputChannel = createMockOutputChannel();
    (vscode.window.terminals as any) = [];
    bridge = new TerminalBridge(outputChannel);
  });

  describe('sendInput', () => {
    it('returns sent for empty text after stripping', async () => {
      const result = await bridge.sendInput('session-1', '\n\n');
      expect(result).toBe('sent');
    });

    it('strips trailing newlines before sending', async () => {
      const terminal = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal];

      await bridge.sendInput('session-1', 'hello\n\n');
      expect(terminal.sendText).toHaveBeenCalledWith('hello\r', false);
    });

    it('strips trailing \\r\\n before sending', async () => {
      const terminal = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal];

      await bridge.sendInput('session-1', 'hello\r\n');
      expect(terminal.sendText).toHaveBeenCalledWith('hello\r', false);
    });

    it('sends text to cached terminal without re-resolving', async () => {
      const terminal = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal];

      // First call: auto-detects and caches
      const result1 = await bridge.sendInput('session-1', 'hello');
      expect(result1).toBe('sent');
      expect(terminal.sendText).toHaveBeenCalledWith('hello\r', false);

      // Second call: uses cache directly
      terminal.sendText.mockClear();
      const result2 = await bridge.sendInput('session-1', 'world');
      expect(result2).toBe('sent');
      expect(terminal.sendText).toHaveBeenCalledWith('world\r', false);
    });

    it('re-resolves when cached terminal has exited', async () => {
      const terminal1 = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal1];

      // First send caches the terminal
      await bridge.sendInput('session-1', 'first');
      expect(terminal1.sendText).toHaveBeenCalled();

      // Terminal exits
      (terminal1 as any).exitStatus = { code: 0 };

      // New terminal appears
      const terminal2 = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal2];

      const result = await bridge.sendInput('session-1', 'second');
      expect(result).toBe('sent');
      expect(terminal2.sendText).toHaveBeenCalledWith('second\r', false);
    });
  });

  describe('resolveTerminal — tier 1: auto-detect Claude terminals', () => {
    it('auto-selects a single terminal whose name contains "claude"', async () => {
      const claudeTerminal = createMockTerminal('claude');
      const bashTerminal = createMockTerminal('bash');
      (vscode.window.terminals as any) = [bashTerminal, claudeTerminal];

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('sent');
      expect(claudeTerminal.sendText).toHaveBeenCalledWith('hello\r', false);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('auto-selects case-insensitively (e.g. "Claude Code")', async () => {
      const claudeTerminal = createMockTerminal('Claude Code');
      const bashTerminal = createMockTerminal('bash');
      (vscode.window.terminals as any) = [bashTerminal, claudeTerminal];

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('sent');
      expect(claudeTerminal.sendText).toHaveBeenCalledWith('hello\r', false);
    });

    it('falls through to QuickPick when multiple Claude terminals exist', async () => {
      const claude1 = createMockTerminal('claude 1');
      const claude2 = createMockTerminal('claude 2');
      (vscode.window.terminals as any) = [claude1, claude2];

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
        label: claude1.name,
        description: 'Likely Claude Code',
        terminal: claude1,
      } as any);

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('sent');
      expect(vscode.window.showQuickPick).toHaveBeenCalled();
    });
  });

  describe('resolveTerminal — tier 2: single terminal', () => {
    it('auto-selects the only terminal without QuickPick', async () => {
      const terminal = createMockTerminal('bash');
      (vscode.window.terminals as any) = [terminal];

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('sent');
      expect(terminal.sendText).toHaveBeenCalledWith('hello\r', false);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });
  });

  describe('resolveTerminal — tier 3: QuickPick', () => {
    it('shows QuickPick for multiple non-Claude terminals', async () => {
      const bash = createMockTerminal('bash');
      const zsh = createMockTerminal('zsh');
      (vscode.window.terminals as any) = [bash, zsh];

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
        label: zsh.name,
        description: 'Terminal 2',
        terminal: zsh,
      } as any);

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('sent');
      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      expect(zsh.sendText).toHaveBeenCalledWith('hello\r', false);
    });

    it('returns no-terminal when user cancels QuickPick', async () => {
      const bash = createMockTerminal('bash');
      const zsh = createMockTerminal('zsh');
      (vscode.window.terminals as any) = [bash, zsh];

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('no-terminal');
    });

    it('sorts Claude-matching terminals first in QuickPick', async () => {
      const bash = createMockTerminal('bash');
      const claude = createMockTerminal('claude');
      const zsh = createMockTerminal('zsh');
      const claude2 = createMockTerminal('Claude (Conductor)');
      (vscode.window.terminals as any) = [bash, claude, zsh, claude2];

      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
        label: claude.name,
        description: 'Likely Claude Code',
        terminal: claude,
      } as any);

      await bridge.sendInput('session-1', 'hello');

      const quickPickItems = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as any[];
      // Claude-matching terminals should be first
      expect(quickPickItems[0].description).toBe('Likely Claude Code');
      expect(quickPickItems[1].description).toBe('Likely Claude Code');
    });
  });

  describe('resolveTerminal — no terminals', () => {
    it('returns no-terminal and shows info message', async () => {
      (vscode.window.terminals as any) = [];

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('no-terminal');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'No terminals open. Open a terminal running Claude Code to send messages.'
      );
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('filters out exited terminals', async () => {
      const exited = createMockTerminal('claude', true);
      (vscode.window.terminals as any) = [exited];

      const result = await bridge.sendInput('session-1', 'hello');
      expect(result).toBe('no-terminal');
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });
  });

  describe('hasTerminal', () => {
    it('returns false when no terminal is cached', () => {
      expect(bridge.hasTerminal('session-1')).toBe(false);
    });

    it('returns true after terminal is cached via sendInput', async () => {
      const terminal = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal];

      await bridge.sendInput('session-1', 'hello');
      expect(bridge.hasTerminal('session-1')).toBe(true);
    });
  });

  describe('terminal close event', () => {
    it('evicts cached terminal when it closes', async () => {
      const terminal = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal];

      await bridge.sendInput('session-1', 'hello');
      expect(bridge.hasTerminal('session-1')).toBe(true);

      // Simulate terminal close
      closeListenerCallback?.(terminal);
      expect(bridge.hasTerminal('session-1')).toBe(false);
    });

    it('does not evict unrelated terminals', async () => {
      const terminal1 = createMockTerminal('claude');
      const terminal2 = createMockTerminal('bash');
      (vscode.window.terminals as any) = [terminal1];

      await bridge.sendInput('session-1', 'hello');

      // Close a different terminal
      closeListenerCallback?.(terminal2);
      expect(bridge.hasTerminal('session-1')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('clears cache and removes listener', async () => {
      const terminal = createMockTerminal('claude');
      (vscode.window.terminals as any) = [terminal];

      await bridge.sendInput('session-1', 'hello');
      expect(bridge.hasTerminal('session-1')).toBe(true);

      bridge.dispose();
      expect(bridge.hasTerminal('session-1')).toBe(false);
    });
  });
});
