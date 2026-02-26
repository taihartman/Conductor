/**
 * @module ConductorPseudoterminal
 *
 * Bridges node-pty output to a VS Code terminal panel via `vscode.Pseudoterminal`.
 *
 * @remarks
 * Data arriving before `open()` is buffered and flushed when the terminal opens.
 * This prevents data loss from node-pty emitting output before VS Code is ready.
 */

import * as vscode from 'vscode';
import { IConductorPseudoterminal, PseudoterminalCallbacks } from './IConductorPseudoterminal';
import { LOG_PREFIX } from '../constants';

/**
 * VS Code Pseudoterminal implementation that bridges node-pty to the terminal panel.
 *
 * @remarks
 * - `write(data)` → buffers pre-open, fires `onDidWrite` post-open
 * - `handleInput(data)` → forwards to `callbacks.onInput` (→ pty stdin)
 * - `setDimensions(dims)` → forwards to `callbacks.onResize` (→ pty resize)
 * - `close()` → VS Code calls this when user closes tab → `callbacks.onClose` (→ pty kill)
 * - `exit(code)` → fires `onDidClose` to tell VS Code the process ended
 */
export class ConductorPseudoterminal implements IConductorPseudoterminal {
  private readonly _onDidWrite = new vscode.EventEmitter<string>();
  readonly onDidWrite = this._onDidWrite.event;

  private readonly _onDidClose = new vscode.EventEmitter<number | void>();
  readonly onDidClose = this._onDidClose.event;

  private readonly callbacks: PseudoterminalCallbacks;
  private preOpenBuffer: string[] = [];
  private isOpen = false;

  constructor(callbacks: PseudoterminalCallbacks) {
    this.callbacks = callbacks;
    console.log(`${LOG_PREFIX.CONDUCTOR_PSEUDOTERMINAL} Created`);
  }

  /**
   * Called by VS Code when the terminal panel is ready to receive data.
   *
   * @param initialDimensions - Terminal dimensions at open time (may be undefined)
   */
  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    console.log(
      `${LOG_PREFIX.CONDUCTOR_PSEUDOTERMINAL} Opened (dimensions: ${initialDimensions?.columns}x${initialDimensions?.rows})`
    );
    this.isOpen = true;

    // Flush pre-open buffer
    for (const data of this.preOpenBuffer) {
      this._onDidWrite.fire(data);
    }
    this.preOpenBuffer = [];

    // Forward initial dimensions to the PTY process
    if (initialDimensions) {
      this.callbacks.onResize(initialDimensions.columns, initialDimensions.rows);
    }
  }

  /**
   * Called by VS Code when the user closes the terminal tab.
   * Forwards to the close callback which should kill the PTY process.
   */
  close(): void {
    console.log(`${LOG_PREFIX.CONDUCTOR_PSEUDOTERMINAL} Close requested by VS Code`);
    this.callbacks.onClose();
  }

  /**
   * Called by VS Code when the user types in the terminal panel.
   * Forwards to the input callback which should write to PTY stdin.
   * @param data - Raw keystroke data from the terminal
   */
  handleInput(data: string): void {
    this.callbacks.onInput(data);
  }

  /**
   * Called by VS Code when the terminal panel is resized.
   * Forwards to the resize callback which should resize the PTY.
   * @param dimensions - New terminal dimensions
   */
  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.callbacks.onResize(dimensions.columns, dimensions.rows);
  }

  /**
   * Push PTY output data to the VS Code terminal panel.
   * Buffers data if `open()` hasn't been called yet.
   * @param data - PTY output data to write
   */
  write(data: string): void {
    if (this.isOpen) {
      this._onDidWrite.fire(data);
    } else {
      this.preOpenBuffer.push(data);
    }
  }

  /**
   * Signal that the PTY process has exited. Fires `onDidClose` so VS Code
   * can update the terminal tab UI (e.g. show "Terminal process terminated").
   * @param code - Process exit code
   */
  exit(code: number): void {
    console.log(`${LOG_PREFIX.CONDUCTOR_PSEUDOTERMINAL} Exit with code ${code}`);
    this._onDidClose.fire(code);
  }

  /** Release emitters and clear buffers. */
  dispose(): void {
    this.preOpenBuffer = [];
    this._onDidWrite.dispose();
    this._onDidClose.dispose();
    console.log(`${LOG_PREFIX.CONDUCTOR_PSEUDOTERMINAL} Disposed`);
  }
}
