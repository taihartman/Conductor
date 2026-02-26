/**
 * @module ProcessDiscovery
 *
 * Discovers which VS Code terminal (if any) owns a running Claude Code session
 * by walking the process tree via `pgrep` and `ps`.
 *
 * @remarks
 * macOS/Linux only — returns empty result on Windows.
 * All exec calls use `execFile` (not `exec`) for security and have a 5s timeout.
 */

import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { IProcessDiscovery, ProcessOwnerResult } from './IProcessDiscovery';
import { LOG_PREFIX, PTY } from '../constants';

/** Timeout (ms) for all child_process.execFile calls. */
const EXEC_TIMEOUT_MS = 5_000;

/** Terminal names created by Conductor — skip these during discovery. */
const CONDUCTOR_TERMINAL_NAMES: Set<string> = new Set([
  PTY.TERMINAL_NAME,
  PTY.RESUMED_TERMINAL_NAME,
]);

/**
 * Discovers the VS Code terminal owning a Claude Code session by inspecting
 * child processes of each terminal's shell.
 *
 * @remarks
 * Strategy:
 * 1. Iterate `vscode.window.terminals` to get each shell PID
 * 2. `pgrep -P <shellPid>` to find child processes
 * 3. `ps -o command=` to read the command line of each child
 * 4. Match `--resume <sessionId>` or `--session-id <sessionId>` in args
 * 5. For bare `claude` processes: match CWD via `lsof -a -p <pid> -d cwd`
 */
export class ProcessDiscovery implements IProcessDiscovery {
  /**
   * Find the VS Code terminal that owns a Claude Code session.
   * @param sessionId - The session ID to search for
   * @param cwd - Optional working directory for CWD-based matching
   * @returns Terminal and PID if found, empty object otherwise
   */
  async findSessionOwner(sessionId: string, cwd?: string): Promise<ProcessOwnerResult> {
    // Platform guard: pgrep/ps/lsof are not available on Windows
    if (process.platform === 'win32') {
      console.log(`${LOG_PREFIX.PROCESS_DISCOVERY} Skipping: Windows platform`);
      return {};
    }

    const terminals = vscode.window.terminals;
    if (terminals.length === 0) {
      console.log(`${LOG_PREFIX.PROCESS_DISCOVERY} No terminals open`);
      return {};
    }

    for (const terminal of terminals) {
      // Skip Conductor-owned terminals — they're already managed
      if (CONDUCTOR_TERMINAL_NAMES.has(terminal.name)) {
        continue;
      }

      const shellPid = await terminal.processId;
      if (!shellPid) {
        continue;
      }

      const result = await this.checkTerminal(terminal, shellPid, sessionId, cwd);
      if (result.terminal) {
        return result;
      }
    }

    console.log(`${LOG_PREFIX.PROCESS_DISCOVERY} No terminal found for session ${sessionId}`);
    return {};
  }

  /**
   * Check a single terminal's child processes for a matching Claude session.
   * @param terminal - The VS Code terminal to inspect
   * @param shellPid - The shell process ID of the terminal
   * @param sessionId - The session ID to match
   * @param cwd - Optional CWD for bare claude process matching
   * @returns Terminal and PID if matched, empty object otherwise
   */
  private async checkTerminal(
    terminal: vscode.Terminal,
    shellPid: number,
    sessionId: string,
    cwd?: string
  ): Promise<ProcessOwnerResult> {
    let childPids: number[];
    try {
      childPids = await this.getChildPids(shellPid);
    } catch {
      return {};
    }

    for (const pid of childPids) {
      let commandLine: string;
      try {
        commandLine = await this.getCommandLine(pid);
      } catch {
        continue;
      }

      // Check if this is a claude process
      if (!this.isClaudeProcess(commandLine)) {
        continue;
      }

      // Match by session ID in command line args
      if (this.matchesSessionId(commandLine, sessionId)) {
        console.log(
          `${LOG_PREFIX.PROCESS_DISCOVERY} Matched session ${sessionId} → terminal "${terminal.name}" (pid: ${pid})`
        );
        return { terminal, claudePid: pid };
      }

      // For bare "claude" (no --resume/--session-id), try CWD match
      if (cwd && this.isBareClaudeProcess(commandLine)) {
        const processCwd = await this.getProcessCwd(pid);
        if (processCwd && this.normalizePath(processCwd) === this.normalizePath(cwd)) {
          console.log(
            `${LOG_PREFIX.PROCESS_DISCOVERY} Matched session ${sessionId} by CWD → terminal "${terminal.name}" (pid: ${pid})`
          );
          return { terminal, claudePid: pid };
        }
      }
    }

    return {};
  }

  /**
   * Get child PIDs of a parent process via pgrep.
   * @param parentPid - Parent process ID
   * @returns Array of child PIDs
   */
  private getChildPids(parentPid: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
      execFile('pgrep', ['-P', String(parentPid)], { timeout: EXEC_TIMEOUT_MS }, (err, stdout) => {
        if (err) {
          // pgrep exits with 1 when no children found — not an error
          if ((err as NodeJS.ErrnoException).code === '1' || err.killed) {
            resolve([]);
          } else {
            reject(err);
          }
          return;
        }
        const pids = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(Number)
          .filter((n) => !isNaN(n));
        resolve(pids);
      });
    });
  }

  /**
   * Get the full command line of a process via ps.
   * @param pid - Process ID to inspect
   * @returns Full command line string
   */
  private getCommandLine(pid: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'ps',
        ['-o', 'command=', '-p', String(pid)],
        { timeout: EXEC_TIMEOUT_MS },
        (err, stdout) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  /**
   * Get the current working directory of a process via lsof.
   * @param pid - Process ID to inspect
   * @returns CWD path, or null if unavailable
   */
  private getProcessCwd(pid: number): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        'lsof',
        ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
        { timeout: EXEC_TIMEOUT_MS },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          // lsof -Fn output: lines starting with 'n' contain the path
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.startsWith('n') && line.length > 1) {
              resolve(line.slice(1));
              return;
            }
          }
          resolve(null);
        }
      );
    });
  }

  /**
   * Check if a command line represents a Claude process.
   * @param commandLine - Full command line string
   * @returns Whether the command matches a Claude process pattern
   */
  private isClaudeProcess(commandLine: string): boolean {
    // Match "claude" as a standalone command (not as substring of another word)
    // Handles: "claude", "/path/to/claude", "node /path/to/claude"
    return /(?:^|\s|\/)claude(?:\s|$)/.test(commandLine);
  }

  /**
   * Check if command line contains --resume or --session-id with the given ID.
   * @param commandLine - Full command line string
   * @param sessionId - Session ID to match
   * @returns Whether the command line contains the session ID
   */
  private matchesSessionId(commandLine: string, sessionId: string): boolean {
    return (
      commandLine.includes(`--resume ${sessionId}`) ||
      commandLine.includes(`--session-id ${sessionId}`)
    );
  }

  /**
   * Check if command line is a bare "claude" invocation (no session args).
   * @param commandLine - Full command line string
   * @returns Whether the process has no --resume or --session-id flags
   */
  private isBareClaudeProcess(commandLine: string): boolean {
    return !commandLine.includes('--resume') && !commandLine.includes('--session-id');
  }

  /**
   * Normalize a path by removing trailing slashes for comparison.
   * @param p - Path to normalize
   * @returns Path without trailing slashes
   */
  private normalizePath(p: string): string {
    return p.replace(/\/+$/, '');
  }
}
