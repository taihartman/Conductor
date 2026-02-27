import { HistoryEntry } from '../models/types';

/**
 * Builds history entries from persisted session metadata for the History tab.
 *
 * @remarks
 * Reads from {@link ISessionHistoryStore}, validates JSONL file existence,
 * enriches display names from {@link ISessionNameStore}, and filters out
 * sub-agent sessions and sessions currently active in the dashboard.
 */
export interface ISessionHistoryService {
  /**
   * Build the list of history entries for the webview.
   *
   * @param activeSessionIds - Set of session IDs currently tracked by SessionTracker
   * @returns Sorted array of history entries (newest first)
   */
  buildEntries(activeSessionIds: Set<string>): HistoryEntry[];
}
