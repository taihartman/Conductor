/**
 * @module IContinuationGrouper
 *
 * Interface for grouping continuation sessions (same slug + cwd) into
 * merged presentation units. Continuation sessions are created when a user
 * clears context and auto-accepts in Claude Code — each gets a new JSONL
 * file and session ID but shares the same slug.
 */

import { SessionInfo } from '../models/types';

/** Minimal session data required by the grouper for building groups. */
export interface GroupableSession {
  info: SessionInfo;
  parentSessionId?: string;
  slugIsExplicit: boolean;
}

/** Contract for grouping continuation sessions by (slug, cwd). */
export interface IContinuationGrouper {
  /** Mark groups as needing rebuild (call on session add, slug change, session removal). */
  markDirty(): void;

  /** Rebuild groups if dirty. Accepts current sessions map. */
  ensureFresh(sessions: ReadonlyMap<string, GroupableSession>): void;

  /** Resolve any sessionId to its primary (canonical) ID. Identity for ungrouped sessions. */
  getPrimaryId(sessionId: string): string;

  /** Get all member IDs for a group (returns [sessionId] for ungrouped sessions). */
  getGroupMembers(primaryId: string): readonly string[];

  /** Get the most recent member by lastActivityAt. */
  getMostRecentMember(
    primaryId: string,
    sessions: ReadonlyMap<string, { info: SessionInfo }>
  ): string;

  /** Whether a sessionId belongs to a multi-member group. */
  isGrouped(sessionId: string): boolean;
}
