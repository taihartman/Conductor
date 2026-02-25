import * as vscode from 'vscode';
import { ProjectScanner } from './ProjectScanner';
import { TranscriptWatcher, WatcherEvent } from './TranscriptWatcher';
import { SessionFile } from './ProjectScanner';
import { ToolStats } from '../analytics/ToolStats';
import { TokenCounter } from '../analytics/TokenCounter';
import {
  JsonlRecord,
  AssistantRecord,
  UserRecord,
  SystemRecord,
  SummaryRecord,
  ProgressRecord,
  SessionInfo,
  SessionStatus,
  ActivityEvent,
  ToolStatEntry,
  TokenSummary,
  ToolUseContentBlock,
  ToolResultContentBlock,
  TextContentBlock,
} from '../models/types';

interface InternalSessionState {
  info: SessionInfo;
  lastAssistantTime: number;
  lastStopReason: string | null;
  idleTimer?: ReturnType<typeof setTimeout>;
  isInitialReplayDone: boolean;
}

export interface DashboardState {
  sessions: SessionInfo[];
  activities: ActivityEvent[];
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
}

const IDLE_TIMEOUT_MS = 30_000;
const MAX_ACTIVITIES = 500;

export class SessionTracker implements vscode.Disposable {
  private readonly scanner: ProjectScanner;
  private watcher: TranscriptWatcher | undefined;
  private readonly sessions: Map<string, InternalSessionState> = new Map();
  private readonly activities: ActivityEvent[] = [];
  private readonly toolStats: ToolStats = new ToolStats();
  private readonly tokenCounter: TokenCounter = new TokenCounter();
  private readonly outputChannel: vscode.OutputChannel;

  private readonly _onStateChanged = new vscode.EventEmitter<void>();
  public readonly onStateChanged = this._onStateChanged.event;

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private focusedSessionId?: string;
  private eventCounter = 0;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.scanner = new ProjectScanner();
  }

  start(): void {
    this.watcher = new TranscriptWatcher(
      this.scanner,
      this.outputChannel,
      (event) => this.handleRecords(event),
      (file) => this.handleNewFile(file)
    );
    this.watcher.start();
    this.outputChannel.appendLine('Session tracking started');
  }

  refresh(): void {
    this.outputChannel.appendLine('Manual refresh triggered');
    // Re-scan for recent files only (last 24 hours)
    const files = this.scanner.scanSessionFiles(undefined, 24 * 60 * 60 * 1000);
    for (const file of files) {
      if (!this.sessions.has(file.sessionId)) {
        this.handleNewFile(file);
      }
    }
  }

  focusSession(sessionId: string): void {
    this.focusedSessionId = sessionId;
  }

  getState(): DashboardState {
    const sessions = Array.from(this.sessions.values())
      .map((s) => s.info)
      .sort(
        (a, b) =>
          new Date(b.lastActivityAt).getTime() -
          new Date(a.lastActivityAt).getTime()
      );

    const activities = this.focusedSessionId
      ? this.activities.filter(
          (a) => a.sessionId === this.focusedSessionId
        )
      : this.activities;

    return {
      sessions,
      activities: activities.slice(-200),
      toolStats: this.toolStats.getStats(),
      tokenSummaries: this.tokenCounter.getSummaries(),
    };
  }

  private handleNewFile(file: SessionFile): void {
    if (!this.sessions.has(file.sessionId)) {
      this.sessions.set(file.sessionId, {
        info: {
          sessionId: file.sessionId,
          slug: file.sessionId.substring(0, 8),
          summary: '',
          status: 'idle',
          model: '',
          gitBranch: '',
          cwd: '',
          startedAt: file.modifiedAt.toISOString(),
          lastActivityAt: file.modifiedAt.toISOString(),
          turnCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
          isSubAgent: file.isSubAgent,
          filePath: file.filePath,
        },
        lastAssistantTime: 0,
        lastStopReason: null,
        isInitialReplayDone: false,
      });
    }
  }

  private handleRecords(event: WatcherEvent): void {
    const { sessionFile, records } = event;

    for (const record of records) {
      this.processRecord(sessionFile, record);
    }

    // On first read of a file, check if the data is historical
    const session = this.sessions.get(sessionFile.sessionId);
    if (session && !session.isInitialReplayDone) {
      session.isInitialReplayDone = true;
      const lastRecord = records[records.length - 1];
      const lastRecordTime = lastRecord?.timestamp
        ? new Date(lastRecord.timestamp).getTime()
        : 0;
      const STALE_THRESHOLD_MS = 5 * 60 * 1000;
      if (lastRecordTime > 0 && Date.now() - lastRecordTime > STALE_THRESHOLD_MS) {
        session.info.status = 'idle';
        this.clearIdleTimer(session);
      }
    }

    this.emitStateChanged();
  }

  private processRecord(file: SessionFile, record: JsonlRecord): void {
    // Ensure session exists
    if (!this.sessions.has(file.sessionId)) {
      this.handleNewFile(file);
    }
    const session = this.sessions.get(file.sessionId)!;

    // Update common metadata from any record
    if (record.slug) {
      session.info.slug = record.slug;
    }
    if (record.sessionId && record.sessionId !== file.sessionId) {
      // Some records have a different sessionId (sub-agents reference parent)
    }
    if (record.gitBranch) {
      session.info.gitBranch = record.gitBranch;
    }
    if (record.cwd) {
      session.info.cwd = record.cwd;
    }
    if (record.timestamp) {
      session.info.lastActivityAt = record.timestamp;
    }

    switch (record.type) {
      case 'assistant':
        this.processAssistant(session, record as AssistantRecord);
        break;
      case 'user':
        this.processUser(session, record as UserRecord);
        break;
      case 'system':
        this.processSystem(session, record as SystemRecord);
        break;
      case 'summary':
        this.processSummary(session, record as SummaryRecord);
        break;
      case 'progress':
        this.processProgress(session, record as ProgressRecord);
        break;
      case 'queue-operation':
      case 'file-history-snapshot':
        // Silently consumed - no UI impact
        break;
    }
  }

  private processAssistant(
    session: InternalSessionState,
    record: AssistantRecord
  ): void {
    const msg = record.message;
    if (!msg) return;

    // Update model
    if (msg.model) {
      session.info.model = msg.model;
    }

    // Accumulate tokens
    if (msg.usage) {
      this.tokenCounter.accumulate(
        session.info.sessionId,
        session.info.slug,
        msg.model || session.info.model,
        msg.usage
      );
      session.info.totalInputTokens += msg.usage.input_tokens || 0;
      session.info.totalOutputTokens += msg.usage.output_tokens || 0;
      session.info.totalCacheReadTokens +=
        msg.usage.cache_read_input_tokens || 0;
      session.info.totalCacheCreationTokens +=
        msg.usage.cache_creation_input_tokens || 0;
    }

    // Process content blocks
    let hasToolUse = false;
    let hasAskUser = false;

    for (const block of msg.content || []) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        const toolBlock = block as ToolUseContentBlock;

        if (toolBlock.name === 'AskUserQuestion') {
          hasAskUser = true;
        }

        this.toolStats.recordToolCall(
          toolBlock.id,
          toolBlock.name,
          record.timestamp || new Date().toISOString()
        );

        this.addActivity({
          id: `evt-${++this.eventCounter}`,
          sessionId: session.info.sessionId,
          sessionSlug: session.info.slug,
          timestamp: record.timestamp || new Date().toISOString(),
          type: 'tool_call',
          toolName: toolBlock.name,
          toolInput: this.summarizeToolInput(toolBlock.name, toolBlock.input),
        });
      } else if (block.type === 'text') {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          this.addActivity({
            id: `evt-${++this.eventCounter}`,
            sessionId: session.info.sessionId,
            sessionSlug: session.info.slug,
            timestamp: record.timestamp || new Date().toISOString(),
            type: 'text',
            text:
              textBlock.text.length > 200
                ? textBlock.text.substring(0, 200) + '...'
                : textBlock.text,
          });
        }
      }
    }

    // Update status
    if (hasAskUser) {
      session.info.status = 'waiting';
    } else if (hasToolUse) {
      session.info.status = 'active';
    }

    // Track for fallback idle detection
    session.lastAssistantTime = Date.now();
    session.lastStopReason = msg.stop_reason;

    if (msg.stop_reason === 'end_turn' && !hasToolUse) {
      session.info.turnCount++;
      this.startIdleTimer(session);
    }
  }

  private processUser(
    session: InternalSessionState,
    record: UserRecord
  ): void {
    const msg = record.message;
    if (!msg) return;

    for (const block of msg.content || []) {
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultContentBlock;
        session.info.status = 'active';

        this.toolStats.recordToolResult(
          resultBlock.tool_use_id,
          resultBlock.is_error || false,
          record.timestamp || new Date().toISOString()
        );

        this.addActivity({
          id: `evt-${++this.eventCounter}`,
          sessionId: session.info.sessionId,
          sessionSlug: session.info.slug,
          timestamp: record.timestamp || new Date().toISOString(),
          type: 'tool_result',
          isError: resultBlock.is_error,
        });
      } else if (block.type === 'text') {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          this.addActivity({
            id: `evt-${++this.eventCounter}`,
            sessionId: session.info.sessionId,
            sessionSlug: session.info.slug,
            timestamp: record.timestamp || new Date().toISOString(),
            type: 'user_input',
            text:
              textBlock.text.length > 200
                ? textBlock.text.substring(0, 200) + '...'
                : textBlock.text,
          });

          // User input means a new turn is starting
          session.info.status = 'active';
          this.clearIdleTimer(session);
        }
      }
    }
  }

  private processSystem(
    session: InternalSessionState,
    record: SystemRecord
  ): void {
    if (record.subtype === 'turn_duration') {
      session.info.status = 'idle';
      session.info.turnCount++;
      this.clearIdleTimer(session);

      this.addActivity({
        id: `evt-${++this.eventCounter}`,
        sessionId: session.info.sessionId,
        sessionSlug: session.info.slug,
        timestamp: record.timestamp || new Date().toISOString(),
        type: 'turn_end',
        durationMs: record.durationMs,
      });
    }
  }

  private processSummary(
    session: InternalSessionState,
    record: SummaryRecord
  ): void {
    if (record.summary) {
      session.info.summary = record.summary;
    } else if (record.message?.content) {
      const content = record.message.content;
      if (typeof content === 'string') {
        session.info.summary = content;
      } else if (Array.isArray(content)) {
        const textBlocks = content.filter(
          (b): b is TextContentBlock => b.type === 'text'
        );
        if (textBlocks.length > 0) {
          session.info.summary = textBlocks.map((b) => b.text).join(' ');
        }
      }
    }
  }

  private processProgress(
    _session: InternalSessionState,
    _record: ProgressRecord
  ): void {
    // Progress records are informational; we just keep the session marked active
    _session.info.status = 'active';
  }

  private startIdleTimer(session: InternalSessionState): void {
    this.clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      // Fallback idle detection: no new data for 30s after end_turn
      if (
        session.lastStopReason === 'end_turn' &&
        Date.now() - session.lastAssistantTime >= IDLE_TIMEOUT_MS
      ) {
        session.info.status = 'idle';
        this.emitStateChanged();
      }
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(session: InternalSessionState): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
  }

  private addActivity(event: ActivityEvent): void {
    this.activities.push(event);
    if (this.activities.length > MAX_ACTIVITIES) {
      this.activities.splice(0, this.activities.length - MAX_ACTIVITIES);
    }
  }

  private summarizeToolInput(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    switch (toolName) {
      case 'Read':
        return String(input.file_path || '');
      case 'Write':
        return String(input.file_path || '');
      case 'Edit':
        return String(input.file_path || '');
      case 'Bash':
        return String(input.command || '').substring(0, 100);
      case 'Glob':
        return String(input.pattern || '');
      case 'Grep':
        return `${input.pattern || ''} ${input.path || ''}`.trim();
      case 'Task':
        return String(input.description || '');
      case 'WebSearch':
        return String(input.query || '');
      case 'WebFetch':
        return String(input.url || '').substring(0, 80);
      default:
        return '';
    }
  }

  private emitStateChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._onStateChanged.fire();
    }, 100);
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const session of this.sessions.values()) {
      this.clearIdleTimer(session);
    }
    this._onStateChanged.dispose();
    this.sessions.clear();
    this.activities.length = 0;
  }
}
