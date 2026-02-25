/**
 * @module ToolStats
 *
 * Tracks tool call metrics: invocation counts, error rates, and duration.
 *
 * @remarks
 * Duration is measured by pairing `tool_use` blocks (call start) with their
 * corresponding `tool_result` blocks (call end), matched by `toolUseId`.
 * Calls without a matching result remain in the pending map indefinitely.
 */

import { ToolStatEntry, ActivityEvent } from '../models/types';

/** Internal tracking state for a tool call awaiting its result. */
interface ToolCallTracking {
  toolName: string;
  /** Timestamp (ms since epoch) when the tool call was recorded. */
  startTime: number;
  toolUseId: string;
}

/**
 * Aggregates tool usage statistics across all sessions.
 *
 * @remarks
 * Instances are owned by {@link SessionTracker}. Tool calls are recorded when
 * processing assistant messages, and results are recorded when processing user
 * messages containing `tool_result` blocks. Stats are sent to the webview
 * via the `toolStats:update` IPC message.
 */
export class ToolStats {
  private readonly stats: Map<string, ToolStatEntry> = new Map();
  private readonly pendingCalls: Map<string, ToolCallTracking> = new Map();

  /**
   * Record a tool invocation from an assistant message.
   *
   * @param toolUseId - Unique ID of the tool_use block (used to correlate with result)
   * @param toolName - Name of the tool being invoked
   * @param timestamp - ISO 8601 timestamp of the tool call
   */
  recordToolCall(toolUseId: string, toolName: string, timestamp: string): void {
    this.pendingCalls.set(toolUseId, {
      toolName,
      startTime: new Date(timestamp).getTime(),
      toolUseId,
    });

    const entry = this.getOrCreate(toolName);
    entry.callCount++;
  }

  /**
   * Record the result of a tool invocation from a user message.
   *
   * @remarks
   * Matches the result to a pending call by `toolUseId`. If no pending call is found
   * (e.g., the call was made before tracking started), the result is silently ignored.
   *
   * @param toolUseId - ID of the tool_use block this result corresponds to
   * @param isError - Whether the tool execution resulted in an error
   * @param timestamp - ISO 8601 timestamp of the tool result
   */
  recordToolResult(toolUseId: string, isError: boolean, timestamp: string): void {
    const pending = this.pendingCalls.get(toolUseId);
    if (!pending) {
      return;
    }

    this.pendingCalls.delete(toolUseId);

    const entry = this.getOrCreate(pending.toolName);
    if (isError) {
      entry.errorCount++;
    }

    const endTime = new Date(timestamp).getTime();
    const duration = Math.max(0, endTime - pending.startTime);
    entry.totalDurationMs += duration;
    entry.avgDurationMs =
      entry.callCount > 0 ? Math.round(entry.totalDurationMs / entry.callCount) : 0;
  }

  /**
   * Get aggregated tool statistics sorted by call count (descending).
   *
   * @returns Array of {@link ToolStatEntry} objects for all observed tools
   */
  getStats(): ToolStatEntry[] {
    return Array.from(this.stats.values()).sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Get the elapsed duration of a currently pending tool call.
   *
   * @param toolUseId - ID of the in-flight tool call
   * @returns Elapsed milliseconds since the call started, or `undefined` if not pending
   */
  getToolDuration(toolUseId: string): number | undefined {
    const pending = this.pendingCalls.get(toolUseId);
    if (pending) {
      return Date.now() - pending.startTime;
    }
    return undefined;
  }

  private getOrCreate(toolName: string): ToolStatEntry {
    let entry = this.stats.get(toolName);
    if (!entry) {
      entry = {
        toolName,
        callCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      };
      this.stats.set(toolName, entry);
    }
    return entry;
  }

  clear(): void {
    this.stats.clear();
    this.pendingCalls.clear();
  }
}
