/**
 * @module StatsCacheReader
 *
 * Reads and parses the Claude Code stats-cache.json file.
 *
 * @remarks
 * The stats cache is maintained by Claude Code itself at `~/.claude/stats-cache.json`.
 * This module reads it asynchronously and returns a typed {@link StatsCache} or `null`
 * on any error (file missing, parse failure, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { StatsCache } from '../models/types';
import { FS_PATHS, LOG_PREFIX, USAGE } from '../constants';

/** Reads the Claude Code stats-cache.json file. */
export interface IStatsCacheReader {
  /** Read and parse the stats cache. Returns `null` if the file is missing or invalid. */
  read(): Promise<StatsCache | null>;
}

/** Reads and parses Claude Code's aggregate stats cache from disk. */
export class StatsCacheReader implements IStatsCacheReader {
  private readonly outputChannel: vscode.OutputChannel;

  /** @param outputChannel - VS Code output channel for logging */
  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /** @inheritdoc */
  async read(): Promise<StatsCache | null> {
    const filePath = path.join(os.homedir(), FS_PATHS.CLAUDE_DIR, FS_PATHS.STATS_CACHE_FILE);

    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StatsCache;

      if (parsed.version !== USAGE.SUPPORTED_CACHE_VERSION) {
        const msg = `${LOG_PREFIX.USAGE_READER} Unexpected stats-cache version: ${parsed.version} (expected ${USAGE.SUPPORTED_CACHE_VERSION})`;
        console.log(msg);
        this.outputChannel.appendLine(msg);
      }

      return parsed;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.log(`${LOG_PREFIX.USAGE_READER} Stats cache not found: ${filePath}`);
      } else {
        const msg = `${LOG_PREFIX.USAGE_READER} Failed to read stats cache: ${err}`;
        console.log(msg);
        this.outputChannel.appendLine(msg);
      }
      return null;
    }
  }
}
