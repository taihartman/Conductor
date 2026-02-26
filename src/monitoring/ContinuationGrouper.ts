/**
 * @module ContinuationGrouper
 *
 * Groups continuation sessions (same slug + cwd) into merged presentation
 * units. Uses a lazy rebuild pattern with a dirty flag — groups are only
 * rebuilt when marked dirty, not on every state query.
 *
 * @remarks
 * Extracted as a composed collaborator of {@link SessionTracker}, following
 * the same pattern as {@link ToolStats}, {@link TokenCounter}, and
 * {@link ConversationBuilder}.
 *
 * **Merge key:** `(slug, cwd)` — sessions with the same slug AND cwd are
 * grouped. Sessions without an explicit slug (i.e. `slugIsExplicit: false`)
 * are excluded from grouping.
 *
 * **Primary session:** The earliest session (by `startedAt`) in each group
 * becomes the canonical/primary ID used externally.
 */

import { SessionInfo } from '../models/types';
import { IContinuationGrouper, GroupableSession } from './IContinuationGrouper';

/**
 * Groups continuation sessions by `(slug, cwd)` for merged presentation.
 *
 * @see {@link IContinuationGrouper} for interface documentation.
 */
export class ContinuationGrouper implements IContinuationGrouper {
  /** Primary session ID → ordered list of all member session IDs. */
  private continuationGroups: Map<string, string[]> = new Map();
  /** Any session ID → its primary session ID. */
  private sessionToPrimary: Map<string, string> = new Map();
  /** Whether groups need rebuilding. */
  private dirty = true;

  /**
   * Mark groups as needing rebuild on next access.
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Rebuild groups if dirty, using the current sessions map.
   *
   * @param sessions - Current session map to build groups from
   */
  ensureFresh(sessions: ReadonlyMap<string, GroupableSession>): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild(sessions);
  }

  /**
   * Resolve any session ID to its primary (canonical) group ID.
   *
   * @param sessionId - Session ID to resolve
   * @returns The primary session ID, or the input itself if ungrouped
   */
  getPrimaryId(sessionId: string): string {
    return this.sessionToPrimary.get(sessionId) ?? sessionId;
  }

  /**
   * Get all member IDs for a continuation group.
   *
   * @param primaryId - Primary session ID of the group
   * @returns Ordered list of member session IDs (earliest first)
   */
  getGroupMembers(primaryId: string): readonly string[] {
    return this.continuationGroups.get(primaryId) ?? [primaryId];
  }

  /**
   * Get the most recent member by `lastActivityAt`.
   *
   * @param primaryId - Primary session ID of the group
   * @param sessions - Session map to read activity timestamps from
   * @returns Session ID of the member with the latest activity
   */
  getMostRecentMember(
    primaryId: string,
    sessions: ReadonlyMap<string, { info: SessionInfo }>
  ): string {
    const members = this.continuationGroups.get(primaryId);
    if (!members || members.length <= 1) return primaryId;

    let mostRecent = primaryId;
    let latestTime = '';

    for (const memberId of members) {
      const session = sessions.get(memberId);
      if (session && session.info.lastActivityAt > latestTime) {
        latestTime = session.info.lastActivityAt;
        mostRecent = memberId;
      }
    }

    return mostRecent;
  }

  /**
   * Whether a session ID belongs to a multi-member continuation group.
   *
   * @param sessionId - Session ID to check
   * @returns `true` if the session is part of a group with 2+ members
   */
  isGrouped(sessionId: string): boolean {
    const primaryId = this.sessionToPrimary.get(sessionId);
    if (!primaryId) return false;
    const members = this.continuationGroups.get(primaryId);
    return members !== undefined && members.length > 1;
  }

  /**
   * Rebuild all groups from scratch using the current session map.
   *
   * @param sessions - Current session map to build groups from
   */
  private rebuild(sessions: ReadonlyMap<string, GroupableSession>): void {
    this.continuationGroups.clear();
    this.sessionToPrimary.clear();

    // Group non-sub-agent sessions with explicit slugs by (slug, cwd)
    const groupsByKey = new Map<string, Array<{ id: string; startedAt: string }>>();

    for (const [id, session] of sessions) {
      // Skip sub-agents — they have their own parent relationship
      if (session.info.isSubAgent) continue;
      // Skip sessions without an explicit slug
      if (!session.slugIsExplicit) continue;

      const key = `${session.info.slug}\0${session.info.cwd}`;
      let group = groupsByKey.get(key);
      if (!group) {
        group = [];
        groupsByKey.set(key, group);
      }
      group.push({ id, startedAt: session.info.startedAt });
    }

    // Sort each group by startedAt ascending; earliest = primary
    for (const group of groupsByKey.values()) {
      group.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

      const primaryId = group[0].id;
      const memberIds = group.map((m) => m.id);

      this.continuationGroups.set(primaryId, memberIds);
      for (const memberId of memberIds) {
        this.sessionToPrimary.set(memberId, primaryId);
      }
    }

    // Identity-map ungrouped non-sub-agent sessions
    for (const [id, session] of sessions) {
      if (session.info.isSubAgent) continue;
      if (!this.sessionToPrimary.has(id)) {
        this.sessionToPrimary.set(id, id);
        this.continuationGroups.set(id, [id]);
      }
    }
  }
}
