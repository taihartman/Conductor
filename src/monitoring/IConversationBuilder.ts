/**
 * @module IConversationBuilder
 *
 * Interface for building conversation transcripts from JSONL records.
 * Extracted as a composed collaborator of {@link SessionTracker} to keep
 * conversation logic separate from activity event processing.
 */

import {
  AssistantRecord,
  UserRecord,
  SystemRecord,
  SummaryRecord,
  ConversationTurn,
} from '../models/types';

/** Contract for building conversation transcripts from JSONL records. */
export interface IConversationBuilder {
  /** Process an assistant record into a conversation turn. */
  processAssistant(sessionId: string, record: AssistantRecord): void;
  /** Process a user record — pairs tool results, creates user text turns. */
  processUser(sessionId: string, record: UserRecord): void;
  /** Process a system record (turn_end, summary). */
  processSystem(sessionId: string, record: SystemRecord): void;
  /** Process a summary record. */
  processSummary(sessionId: string, record: SummaryRecord): void;
  /** Get filtered conversation turns for the webview. */
  getFilteredConversation(
    focusedSessionId: string | null,
    sessions: Map<string, { parentSessionId?: string; isSubAgent: boolean }>
  ): ConversationTurn[];
  /** Clear conversation data for a session (stale cleanup). */
  clearSession(sessionId: string): void;
  dispose(): void;
}
