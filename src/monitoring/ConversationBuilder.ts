/**
 * @module ConversationBuilder
 *
 * Builds conversation transcripts from JSONL records, pairing tool calls
 * with their results and maintaining per-session turn history.
 *
 * @remarks
 * Extracted from {@link SessionTracker} as a composed collaborator following
 * the same pattern as {@link ToolStats} and {@link TokenCounter}.
 * Tool pairing uses an O(1) lookup map keyed by `toolUseId`.
 */

import { IConversationBuilder } from './IConversationBuilder';
import { summarizeToolInput } from '../config/toolSummarizers';
import {
  TRUNCATION,
  MAX_CONVERSATION_TURNS_PER_SESSION,
  SPECIAL_NAMES,
  CONTENT_BLOCK_TYPES,
  CONVERSATION_ROLES,
  SYSTEM_EVENTS,
} from '../constants';
import {
  AssistantRecord,
  UserRecord,
  SystemRecord,
  SummaryRecord,
  ConversationTurn,
  ToolInteraction,
  ToolUseContentBlock,
  ToolResultContentBlock,
  TextContentBlock,
  normalizeUserContent,
} from '../models/types';

/** Pending tool call awaiting its result. */
interface PendingToolCall {
  /** Reference to the ToolInteraction stored on the assistant turn. */
  interaction: ToolInteraction;
}

/** Builds conversation transcripts from JSONL records, pairing tool calls with results. */
export class ConversationBuilder implements IConversationBuilder {
  private readonly conversationBySession: Map<string, ConversationTurn[]> = new Map();
  private readonly pendingToolCalls: Map<string, PendingToolCall> = new Map();
  private turnCounter = 0;

  /**
   * Process an assistant record into conversation turns with tool interactions.
   * @param sessionId
   * @param record
   */
  processAssistant(sessionId: string, record: AssistantRecord): void {
    const msg = record.message;
    if (!msg) return;

    const timestamp = record.timestamp || new Date().toISOString();
    const tools: ToolInteraction[] = [];
    let text = '';

    for (const block of msg.content || []) {
      if (block.type === CONTENT_BLOCK_TYPES.TEXT) {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          if (text.length > 0) text += '\n';
          text += textBlock.text;
        }
      } else if (block.type === CONTENT_BLOCK_TYPES.TOOL_USE) {
        const toolBlock = block as ToolUseContentBlock;
        const inputJson = this.truncate(JSON.stringify(toolBlock.input), TRUNCATION.TOOL_INPUT_MAX);
        const inputSummary = summarizeToolInput(toolBlock.name, toolBlock.input);

        const interaction: ToolInteraction = {
          toolUseId: toolBlock.id,
          toolName: toolBlock.name,
          inputJson,
          inputSummary,
          isError: false,
          calledAt: timestamp,
        };

        tools.push(interaction);
        this.pendingToolCalls.set(toolBlock.id, { interaction });
      }
    }

    // Truncate assembled text
    if (text.length > TRUNCATION.CONVERSATION_TEXT_MAX) {
      text = text.substring(0, TRUNCATION.CONVERSATION_TEXT_MAX) + '...';
    }

    // Detect sub-agent spawning via Task tool
    let subAgentSessionId: string | undefined;
    let subAgentDescription: string | undefined;
    for (const tool of tools) {
      if (tool.toolName === SPECIAL_NAMES.TASK_TOOL) {
        try {
          const parsed = JSON.parse(tool.inputJson);
          subAgentDescription = parsed.description
            ? String(parsed.description).substring(0, TRUNCATION.DESCRIPTION_MAX)
            : undefined;
        } catch {
          // inputJson was truncated — no description available
        }
        // subAgentSessionId is set later when the sub-agent's first record arrives
        break;
      }
    }

    const turn: ConversationTurn = {
      id: `turn-${++this.turnCounter}`,
      sessionId,
      role: CONVERSATION_ROLES.ASSISTANT,
      timestamp,
      model: msg.model,
      usage: msg.usage,
      subAgentSessionId,
      subAgentDescription,
    };

    if (text) turn.text = text;
    if (tools.length > 0) turn.tools = tools;

    this.addTurn(sessionId, turn);
  }

  /**
   * Process a user record: pair tool results with pending calls and create user text turns.
   * @param sessionId
   * @param record
   */
  processUser(sessionId: string, record: UserRecord): void {
    const msg = record.message;
    if (!msg) return;

    const timestamp = record.timestamp || new Date().toISOString();
    let text = '';

    const blocks = normalizeUserContent(msg.content);
    for (const block of blocks) {
      if (block.type === CONTENT_BLOCK_TYPES.TOOL_RESULT) {
        const resultBlock = block as ToolResultContentBlock;
        const pending = this.pendingToolCalls.get(resultBlock.tool_use_id);
        if (pending) {
          // Pair the result with the tool interaction
          pending.interaction.isError = resultBlock.is_error || false;
          pending.interaction.completedAt = timestamp;
          pending.interaction.output = this.extractToolOutput(resultBlock);
          this.pendingToolCalls.delete(resultBlock.tool_use_id);
        }
      } else if (block.type === CONTENT_BLOCK_TYPES.TEXT) {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          if (text.length > 0) text += '\n';
          text += textBlock.text;
        }
      }
    }

    // Only create a user turn if there's actual text (not just tool results)
    if (text) {
      if (text.length > TRUNCATION.CONVERSATION_TEXT_MAX) {
        text = text.substring(0, TRUNCATION.CONVERSATION_TEXT_MAX) + '...';
      }

      const turn: ConversationTurn = {
        id: `turn-${++this.turnCounter}`,
        sessionId,
        role: CONVERSATION_ROLES.USER,
        timestamp,
        text,
      };

      this.addTurn(sessionId, turn);
    }
  }

  /**
   * Process a system record (e.g. turn_duration) into a system turn.
   * @param sessionId
   * @param record
   */
  processSystem(sessionId: string, record: SystemRecord): void {
    if (record.subtype === SPECIAL_NAMES.TURN_DURATION_SUBTYPE) {
      const turn: ConversationTurn = {
        id: `turn-${++this.turnCounter}`,
        sessionId,
        role: CONVERSATION_ROLES.SYSTEM,
        timestamp: record.timestamp || new Date().toISOString(),
        systemEvent: SYSTEM_EVENTS.TURN_END,
        durationMs: record.durationMs,
      };

      this.addTurn(sessionId, turn);
    }
  }

  /**
   * Process a summary record into a system turn with summary text.
   * @param sessionId
   * @param record
   */
  processSummary(sessionId: string, record: SummaryRecord): void {
    let summaryText = '';

    if (record.summary) {
      summaryText = record.summary;
    } else if (record.message?.content) {
      const content = record.message.content;
      if (typeof content === 'string') {
        summaryText = content;
      } else if (Array.isArray(content)) {
        const textBlocks = content.filter(
          (b): b is TextContentBlock => b.type === CONTENT_BLOCK_TYPES.TEXT
        );
        summaryText = textBlocks.map((b) => b.text).join(' ');
      }
    }

    if (summaryText) {
      if (summaryText.length > TRUNCATION.CONVERSATION_TEXT_MAX) {
        summaryText = summaryText.substring(0, TRUNCATION.CONVERSATION_TEXT_MAX) + '...';
      }

      const turn: ConversationTurn = {
        id: `turn-${++this.turnCounter}`,
        sessionId,
        role: CONVERSATION_ROLES.SYSTEM,
        timestamp: record.timestamp || new Date().toISOString(),
        systemEvent: SYSTEM_EVENTS.SUMMARY,
        summary: summaryText,
      };

      this.addTurn(sessionId, turn);
    }
  }

  /**
   * Return conversation turns filtered by focused session, merging parent+child turns.
   * @param focusedSessionId
   * @param sessions
   * @returns Filtered conversation turns
   */
  getFilteredConversation(
    focusedSessionId: string | null,
    sessions: Map<string, { parentSessionId?: string; isSubAgent: boolean }>
  ): ConversationTurn[] {
    if (!focusedSessionId) return [];

    const focused = sessions.get(focusedSessionId);
    if (!focused) return this.conversationBySession.get(focusedSessionId) ?? [];

    if (focused.isSubAgent) {
      return this.conversationBySession.get(focusedSessionId) ?? [];
    }

    // Parent session: merge parent + child conversations
    const childIds: string[] = [];
    for (const [id, info] of sessions) {
      if (info.isSubAgent && info.parentSessionId === focusedSessionId) {
        childIds.push(id);
      }
    }

    if (childIds.length === 0) {
      return this.conversationBySession.get(focusedSessionId) ?? [];
    }

    const merged: ConversationTurn[] = [
      ...(this.conversationBySession.get(focusedSessionId) ?? []),
    ];
    for (const childId of childIds) {
      merged.push(...(this.conversationBySession.get(childId) ?? []));
    }
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged;
  }

  /**
   * Return merged conversation turns for a continuation group, annotated with
   * `continuationSegmentIndex` based on which member each turn belongs to.
   * Also includes sub-agent turns from children of any member.
   *
   * @param memberIds - Ordered list of continuation member session IDs (earliest first)
   * @param sessions - Session metadata map for parent/child resolution
   * @returns Merged and annotated conversation turns
   */
  getFilteredConversationForGroup(
    memberIds: string[],
    sessions: Map<string, { parentSessionId?: string; isSubAgent: boolean }>
  ): ConversationTurn[] {
    const primaryId = memberIds[0];
    const memberSet = new Set(memberIds);
    const memberIndexMap = new Map<string, number>();
    for (let i = 0; i < memberIds.length; i++) {
      memberIndexMap.set(memberIds[i], i);
    }

    const merged: ConversationTurn[] = [];

    // Collect turns from all continuation members, annotating with segment index
    for (const memberId of memberIds) {
      const turns = this.conversationBySession.get(memberId) ?? [];
      const segmentIndex = memberIndexMap.get(memberId) ?? 0;
      for (const turn of turns) {
        merged.push({
          ...turn,
          continuationSegmentIndex: segmentIndex,
        });
      }
    }

    // Collect sub-agent turns from children of any continuation member
    for (const [id, info] of sessions) {
      if (!info.isSubAgent) continue;
      if (!info.parentSessionId) continue;
      // Parent must be the primary (SessionTracker resolves through grouper before calling)
      if (info.parentSessionId === primaryId || memberSet.has(info.parentSessionId)) {
        const childTurns = this.conversationBySession.get(id) ?? [];
        merged.push(...childTurns);
      }
    }

    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged;
  }

  /**
   * Remove all conversation data for a session.
   * @param sessionId
   */
  clearSession(sessionId: string): void {
    this.conversationBySession.delete(sessionId);
  }

  /** Dispose all conversation and pending tool state. */
  dispose(): void {
    this.conversationBySession.clear();
    this.pendingToolCalls.clear();
  }

  private addTurn(sessionId: string, turn: ConversationTurn): void {
    let turns = this.conversationBySession.get(sessionId);
    if (!turns) {
      turns = [];
      this.conversationBySession.set(sessionId, turns);
    }
    turns.push(turn);
    if (turns.length > MAX_CONVERSATION_TURNS_PER_SESSION) {
      turns.splice(0, turns.length - MAX_CONVERSATION_TURNS_PER_SESSION);
    }
  }

  private extractToolOutput(resultBlock: ToolResultContentBlock): string | undefined {
    if (!resultBlock.content) return undefined;

    let output: string;
    if (typeof resultBlock.content === 'string') {
      output = resultBlock.content;
    } else if (Array.isArray(resultBlock.content)) {
      output = resultBlock.content
        .filter((c) => c.type === CONTENT_BLOCK_TYPES.TEXT && c.text)
        .map((c) => c.text)
        .join('\n');
    } else {
      return undefined;
    }

    return this.truncate(output, TRUNCATION.TOOL_OUTPUT_MAX);
  }

  private truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.substring(0, max) + '...';
  }
}
