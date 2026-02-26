import * as vscode from 'vscode';
import { InputSendStatus } from '../models/protocol';
import { ITerminalBridge } from './ITerminalBridge';
import { LOG_PREFIX, TERMINAL_DETECTION } from '../constants';

/**
 * Delivers user input to Claude Code terminals via `terminal.sendText()`.
 *
 * @remarks
 * Auto-detects Claude Code terminals by name pattern matching. Falls back to
 * QuickPick for manual selection when multiple candidates exist. Subsequent
 * sends reuse the cached terminal until it closes.
 */
export class TerminalBridge implements ITerminalBridge {
  private readonly terminalCache = new Map<string, vscode.Terminal>();
  private readonly closeListener: vscode.Disposable;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;

    this.closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [sessionId, cached] of this.terminalCache) {
        if (cached === terminal) {
          console.log(
            `${LOG_PREFIX.TERMINAL_BRIDGE} Terminal closed, evicting cache for ${sessionId}`
          );
          this.terminalCache.delete(sessionId);
          break;
        }
      }
    });

    console.log(`${LOG_PREFIX.TERMINAL_BRIDGE} Initialized`);
  }

  /**
   * Send user input to a Claude Code terminal, auto-detecting or prompting for selection.
   * @param sessionId
   * @param text
   * @returns The send result status
   */
  async sendInput(sessionId: string, text: string): Promise<InputSendStatus> {
    const cleaned = text.replace(/[\r\n]+$/, '');
    if (!cleaned) {
      return 'sent';
    }

    const cached = this.terminalCache.get(sessionId);
    if (cached && cached.exitStatus === undefined) {
      console.log(`${LOG_PREFIX.TERMINAL_BRIDGE} Sending to cached terminal for ${sessionId}`);
      cached.sendText(cleaned + '\r', false);
      return 'sent';
    }

    // Cached terminal exited — evict
    if (cached) {
      this.terminalCache.delete(sessionId);
    }

    const terminal = await this.resolveTerminal();
    if (!terminal) {
      return 'no-terminal';
    }

    this.terminalCache.set(sessionId, terminal);
    console.log(
      `${LOG_PREFIX.TERMINAL_BRIDGE} Sending to terminal "${terminal.name}" for session ${sessionId}`
    );
    this.outputChannel.appendLine(
      `${LOG_PREFIX.TERMINAL_BRIDGE} Linked terminal "${terminal.name}" to session ${sessionId}`
    );
    terminal.sendText(cleaned + '\r', false);
    return 'sent';
  }

  /**
   * Check if a live terminal is cached for the given session.
   * @param sessionId
   * @returns `true` if a live terminal is cached
   */
  hasTerminal(sessionId: string): boolean {
    const terminal = this.terminalCache.get(sessionId);
    return terminal !== undefined && terminal.exitStatus === undefined;
  }

  /** Release the close listener and clear the terminal cache. */
  dispose(): void {
    this.closeListener.dispose();
    this.terminalCache.clear();
    console.log(`${LOG_PREFIX.TERMINAL_BRIDGE} Disposed`);
  }

  /**
   * Resolve the terminal to send input to, using a 3-tier strategy:
   *
   * 1. **Auto-detect** — If exactly one terminal matches the Claude name pattern, use it.
   * 2. **Single terminal** — If only one terminal exists total, use it.
   * 3. **QuickPick** — If multiple terminals exist, prompt the user to select one.
   *
   * Shows an information message if no terminals exist at all.
   *
   * @returns The resolved terminal, or `undefined` if none selected
   */
  private async resolveTerminal(): Promise<vscode.Terminal | undefined> {
    const allTerminals = vscode.window.terminals.filter((t) => t.exitStatus === undefined);

    if (allTerminals.length === 0) {
      console.log(`${LOG_PREFIX.TERMINAL_BRIDGE} No open terminals found`);
      vscode.window.showInformationMessage(
        'No terminals open. Open a terminal running Claude Code to send messages.' // inline-ok: one-off information message
      );
      return undefined;
    }

    // Tier 1: Auto-detect Claude Code terminals by name pattern
    const claudeTerminals = allTerminals.filter((t) =>
      TERMINAL_DETECTION.NAME_PATTERNS.some((pattern) => t.name.toLowerCase().includes(pattern))
    );

    if (claudeTerminals.length === 1) {
      console.log(
        `${LOG_PREFIX.TERMINAL_BRIDGE} Auto-detected Claude terminal: "${claudeTerminals[0].name}"`
      );
      return claudeTerminals[0];
    }

    // Tier 2: Single terminal — use it directly
    if (allTerminals.length === 1) {
      console.log(
        `${LOG_PREFIX.TERMINAL_BRIDGE} Single terminal available: "${allTerminals[0].name}"`
      );
      return allTerminals[0];
    }

    // Tier 3: Multiple terminals — prompt user with QuickPick
    console.log(
      `${LOG_PREFIX.TERMINAL_BRIDGE} ${allTerminals.length} terminals open, prompting user to select`
    );

    // Use claude-matching terminals first in the list for convenience
    const sorted = [...allTerminals].sort((a, b) => {
      const aMatch = this.isClaudeTerminal(a);
      const bMatch = this.isClaudeTerminal(b);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

    const items = sorted.map((t, i) => ({
      label: t.name,
      description: this.isClaudeTerminal(t) ? 'Likely Claude Code' : `Terminal ${i + 1}`,
      terminal: t,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select the terminal running Claude Code',
    });

    return pick?.terminal;
  }

  /**
   * Check if a terminal name matches known Claude Code patterns.
   *
   * @param terminal - The VS Code terminal to check
   * @returns `true` if the terminal name matches a Claude pattern
   */
  private isClaudeTerminal(terminal: vscode.Terminal): boolean {
    return TERMINAL_DETECTION.NAME_PATTERNS.some((pattern) =>
      terminal.name.toLowerCase().includes(pattern)
    );
  }
}
