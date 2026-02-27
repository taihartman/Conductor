import * as fs from 'fs';
import { ISessionHistoryService } from './ISessionHistoryService';
import { ISessionHistoryStore } from './ISessionHistoryStore';
import { ISessionNameStore } from './ISessionNameStore';
import { HistoryEntry } from '../models/types';
import { LOG_PREFIX, FS_PATHS } from '../constants';

/**
 * Builds history entries from persisted session metadata.
 *
 * @remarks
 * Queries {@link ISessionHistoryStore} for all entries, validates that
 * JSONL files still exist on disk, enriches display names from
 * {@link ISessionNameStore}, and excludes sub-agent sessions and sessions
 * currently active in the dashboard.
 */
export class SessionHistoryService implements ISessionHistoryService {
  private readonly historyStore: ISessionHistoryStore;
  private readonly nameStore: ISessionNameStore;

  constructor(historyStore: ISessionHistoryStore, nameStore: ISessionNameStore) {
    this.historyStore = historyStore;
    this.nameStore = nameStore;
  }

  /**
   * Build the list of history entries for the webview.
   *
   * @param activeSessionIds - Set of session IDs currently tracked by SessionTracker
   * @returns Sorted array of history entries (newest first)
   */
  buildEntries(activeSessionIds: Set<string>): HistoryEntry[] {
    const allMeta = this.historyStore.getAll();
    const entries: HistoryEntry[] = [];

    for (const meta of allMeta) {
      // Skip sub-agent sessions
      if (meta.sessionId.startsWith(FS_PATHS.AGENT_PREFIX)) {
        continue;
      }

      // Skip entries whose JSONL file no longer exists
      if (!this.fileExists(meta.filePath)) {
        continue;
      }

      // Get the latest file mtime for lastActivityAt
      const mtime = this.getFileMtime(meta.filePath);
      if (!mtime) {
        continue;
      }

      // Enrich display name: prefer SessionNameStore (may have been updated after save)
      const storedName = this.nameStore.getName(meta.sessionId);
      const displayName = storedName || meta.displayName || meta.sessionId.slice(0, 8); // inline-ok: slug fallback

      entries.push({
        sessionId: meta.sessionId,
        displayName,
        cwd: meta.cwd,
        lastActivityAt: mtime.toISOString(),
        isActive: activeSessionIds.has(meta.sessionId),
      });
    }

    // Sort by lastActivityAt descending (newest first)
    entries.sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );

    console.log(
      `${LOG_PREFIX.HISTORY_SERVICE} Built ${entries.length} history entries (${allMeta.length} total in store)`
    );

    return entries;
  }

  /**
   * Check if a file exists on disk.
   * @param filePath - Absolute path to check
   * @returns `true` if the file exists, `false` otherwise
   */
  private fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Get the modification time of a file.
   * @param filePath - Absolute path to stat
   * @returns The file's mtime, or null if stat fails
   */
  private getFileMtime(filePath: string): Date | null {
    try {
      const stat = fs.statSync(filePath);
      return stat.mtime;
    } catch {
      return null;
    }
  }
}
