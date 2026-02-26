import * as vscode from 'vscode';

/** Result of searching for the VS Code terminal that owns a Claude session. */
export interface ProcessOwnerResult {
  /** The VS Code terminal running the Claude session, if found. */
  terminal?: vscode.Terminal;
  /** PID of the matched Claude process (for logging). */
  claudePid?: number;
}

/**
 * Discovers which VS Code terminal (if any) owns a running Claude Code session.
 *
 * @remarks
 * Used by SessionLauncher.transfer() to find and close an external terminal
 * before resuming the session in Conductor's PTY.
 */
export interface IProcessDiscovery {
  /**
   * Search VS Code terminals for one running a Claude process that matches the given session.
   *
   * @param sessionId - The Claude session ID to match against process command lines
   * @param cwd - Optional working directory for bare `claude` process CWD matching
   * @returns The owning terminal and Claude PID, or empty result if not found
   */
  findSessionOwner(sessionId: string, cwd?: string): Promise<ProcessOwnerResult>;
}
