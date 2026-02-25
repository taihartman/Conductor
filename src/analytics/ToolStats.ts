import { ToolStatEntry, ActivityEvent } from '../models/types';

interface ToolCallTracking {
  toolName: string;
  startTime: number;
  toolUseId: string;
}

export class ToolStats {
  private readonly stats: Map<string, ToolStatEntry> = new Map();
  private readonly pendingCalls: Map<string, ToolCallTracking> = new Map();

  recordToolCall(toolUseId: string, toolName: string, timestamp: string): void {
    this.pendingCalls.set(toolUseId, {
      toolName,
      startTime: new Date(timestamp).getTime(),
      toolUseId,
    });

    const entry = this.getOrCreate(toolName);
    entry.callCount++;
  }

  recordToolResult(
    toolUseId: string,
    isError: boolean,
    timestamp: string
  ): void {
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
      entry.callCount > 0
        ? Math.round(entry.totalDurationMs / entry.callCount)
        : 0;
  }

  getStats(): ToolStatEntry[] {
    return Array.from(this.stats.values()).sort(
      (a, b) => b.callCount - a.callCount
    );
  }

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
