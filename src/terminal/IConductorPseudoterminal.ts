import * as vscode from 'vscode';

/**
 * Callback signatures for ConductorPseudoterminal event forwarding.
 *
 * @remarks
 * These callbacks bridge the VS Code terminal panel to the underlying PTY process.
 * The Pseudoterminal itself has no knowledge of node-pty — it simply invokes the
 * callbacks provided at construction time.
 */
export interface PseudoterminalCallbacks {
  /** Called when the user types in the VS Code terminal panel. Forwards to pty stdin. */
  onInput: (data: string) => void;
  /** Called when the VS Code terminal panel is resized. Forwards to pty resize. */
  onResize: (cols: number, rows: number) => void;
  /** Called when the user closes the VS Code terminal tab. Signals pty to kill. */
  onClose: () => void;
}

/**
 * Bridge between a node-pty process and a VS Code terminal panel.
 *
 * @remarks
 * Implements `vscode.Pseudoterminal` so it can be passed to
 * `vscode.window.createTerminal({ pty })`. Data from node-pty is fed via `write()`,
 * which fires `onDidWrite` for the VS Code terminal to render. User input from the
 * terminal panel flows through `handleInput()` → `callbacks.onInput`.
 */
export interface IConductorPseudoterminal extends vscode.Pseudoterminal {
  /** Push PTY output data to the VS Code terminal panel. Buffers if open() hasn't been called. */
  write(data: string): void;

  /** Signal the VS Code terminal to close (fires onDidClose). */
  exit(code: number): void;

  /** Release all emitters and clear buffers. */
  dispose(): void;
}
