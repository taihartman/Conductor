/**
 * @module SessionTracker
 *
 * Core orchestrator that maps session IDs to state, processes JSONL records,
 * and emits debounced state updates to the dashboard.
 *
 * @remarks
 * **State machine per session:**
 * ```
 * idle → active (user input / tool call)
 *      → waiting (AskUserQuestion tool)
 *      → active (user response / tool result)
 *      → idle (turn_duration system record / IDLE_TIMEOUT_MS expiry)
 * ```
 *
 * **Key behaviors:**
 * - Debounced updates: state changes are batched and emitted after 100ms of quiet
 * - Replay detection: records older than 5 minutes on first file read are marked historical
 * - Stale cleanup: idle sessions older than {@link STALE_SESSION_MS} (4h) are removed
 *   every {@link CLEANUP_INTERVAL_MS} (5min)
 * - Activity buffer: capped at {@link MAX_ACTIVITIES} (500) entries with FIFO eviction
 *
 * **Note:** This class is identified as a god class (~590 lines) and is slated for
 * decomposition in Phase 2 of the extensibility roadmap. See CLAUDE.md.
 */

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
  SubAgentInfo,
  ActivityEvent,
  ToolStatEntry,
  TokenSummary,
  ToolUseContentBlock,
  ToolResultContentBlock,
  TextContentBlock,
} from '../models/types';

/** Internal tracking state for a session, not exposed to the webview. */
interface InternalSessionState {
  /** Public session metadata sent to the dashboard. */
  info: SessionInfo;
  /** Timestamp (ms since epoch) of the last assistant message — used for idle detection. */
  lastAssistantTime: number;
  /** Stop reason from the last assistant message (`'end_turn'` triggers idle timer). */
  lastStopReason: string | null;
  /** Timer handle for the idle timeout fallback. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Whether the initial file replay has completed (for stale detection). */
  isInitialReplayDone: boolean;
  /** Parent session ID for sub-agent relationship tracking. */
  parentSessionId?: string;
  /** Human-readable description extracted from the first user prompt. */
  description: string;
}

/**
 * Complete dashboard state snapshot sent to the webview.
 *
 * @remarks
 * Assembled by {@link SessionTracker.getState} and posted via IPC by {@link DashboardPanel}.
 */
export interface DashboardState {
  sessions: SessionInfo[];
  activities: ActivityEvent[];
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
}

/** Time (ms) after `end_turn` with no new data before a session transitions to idle. */
const IDLE_TIMEOUT_MS = 30_000;
/** Maximum number of activity events kept in the buffer (FIFO eviction). */
const MAX_ACTIVITIES = 500;
/** Sessions idle longer than this (4 hours) are eligible for cleanup. */
const STALE_SESSION_MS = 4 * 60 * 60 * 1000;
/** Interval for the stale session cleanup sweep (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Core session orchestrator that processes JSONL records into dashboard state.
 *
 * @remarks
 * Owns a {@link ProjectScanner}, {@link TranscriptWatcher}, {@link ToolStats},
 * and {@link TokenCounter}. Implements `vscode.Disposable` for cleanup of all
 * timers, watchers, and event emitters.
 *
 * Emits {@link onStateChanged} (debounced 100ms) whenever session state, activities,
 * tool stats, or token counts change.
 */
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
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private focusedSessionId?: string;
  private eventCounter = 0;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.scanner = new ProjectScanner();
  }

  /**
   * Initialize file watching and start processing transcript records.
   *
   * @remarks
   * Creates the {@link TranscriptWatcher}, starts it, and begins periodic
   * stale session cleanup. Call once after construction.
   */
  start(): void {
    console.log('[ClaudeDashboard:SessionTracker] Starting session tracking...');
    this.watcher = new TranscriptWatcher(
      this.scanner,
      this.outputChannel,
      (event) => this.handleRecords(event),
      (file) => this.handleNewFile(file)
    );
    this.watcher.start();
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
    this.outputChannel.appendLine('Session tracking started');
    console.log('[ClaudeDashboard:SessionTracker] Session tracking started');
  }

  /**
   * Manually re-scan for session files (last 24 hours) and register new ones.
   *
   * @remarks
   * Triggered by the `claudeAgentDashboard.refresh` command or the webview
   * `refresh` IPC message. Does not re-read existing tracked files.
   */
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

  /**
   * Set the focused session for activity filtering.
   *
   * @remarks
   * When a session is focused, {@link getState} filters the activity feed to
   * show only events from that session (and its children, if it's a parent).
   *
   * @param sessionId - Session to focus, or pass to filter activities
   */
  focusSession(sessionId: string): void {
    this.focusedSessionId = sessionId;
  }

  /**
   * Assemble the complete dashboard state snapshot.
   *
   * @remarks
   * Builds a hierarchical session list (parents with nested children + orphaned
   * sub-agents), filters activities by focused session, and collects tool stats
   * and token summaries. Activities are capped at the last 200 events.
   *
   * @returns Complete {@link DashboardState} for the webview
   */
  getState(): DashboardState {
    // Build parent → children mapping
    const childrenByParent = new Map<string, SubAgentInfo[]>();
    const orphanedAgents: SessionInfo[] = [];

    for (const session of this.sessions.values()) {
      if (!session.info.isSubAgent) continue;

      const parentId = session.parentSessionId;
      if (parentId && this.sessions.has(parentId)) {
        const children = childrenByParent.get(parentId) || [];
        children.push({
          sessionId: session.info.sessionId,
          slug: session.info.slug,
          status: session.info.status,
          description: session.description || session.info.slug,
          totalInputTokens: session.info.totalInputTokens,
          totalOutputTokens: session.info.totalOutputTokens,
          lastActivityAt: session.info.lastActivityAt,
        });
        childrenByParent.set(parentId, children);
      } else {
        orphanedAgents.push(session.info);
      }
    }

    // Build final sessions list: parents with nested children + orphans
    const parentSessions = Array.from(this.sessions.values())
      .filter((s) => !s.info.isSubAgent)
      .map((s) => ({
        ...s.info,
        childAgents: childrenByParent.get(s.info.sessionId) || [],
      }));

    const sessions = [...parentSessions, ...orphanedAgents].sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );

    // Filter activities: when focused on parent, include child activities
    let activities: ActivityEvent[];
    if (this.focusedSessionId) {
      const childIds = childrenByParent.get(this.focusedSessionId)?.map((c) => c.sessionId) || [];
      const focusSet = new Set([this.focusedSessionId, ...childIds]);
      // If focused on a sub-agent directly, just show that agent's activities
      const isSubAgent = this.sessions.get(this.focusedSessionId)?.info.isSubAgent;
      if (isSubAgent) {
        activities = this.activities.filter((a) => a.sessionId === this.focusedSessionId);
      } else {
        activities = this.activities.filter((a) => focusSet.has(a.sessionId));
      }
    } else {
      activities = this.activities;
    }

    return {
      sessions,
      activities: activities.slice(-200),
      toolStats: this.toolStats.getStats(),
      tokenSummaries: this.tokenCounter.getSummaries(),
    };
  }

  private handleNewFile(file: SessionFile): void {
    console.log(
      `[ClaudeDashboard:SessionTracker] New file: ${file.sessionId} (subAgent=${file.isSubAgent})`
    );
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
          parentSessionId: file.parentSessionId,
          filePath: file.filePath,
        },
        lastAssistantTime: 0,
        lastStopReason: null,
        isInitialReplayDone: false,
        parentSessionId: file.parentSessionId,
        description: '',
      });
    }
  }

  private handleRecords(event: WatcherEvent): void {
    const { sessionFile, records } = event;
    console.log(
      `[ClaudeDashboard:SessionTracker] Processing ${records.length} record(s) for session ${sessionFile.sessionId}`
    );

    for (const record of records) {
      this.processRecord(sessionFile, record);
    }

    // On first read of a file, check if the data is historical
    const session = this.sessions.get(sessionFile.sessionId);
    if (session && !session.isInitialReplayDone) {
      session.isInitialReplayDone = true;
      const lastRecord = records[records.length - 1];
      const lastRecordTime = lastRecord?.timestamp ? new Date(lastRecord.timestamp).getTime() : 0;
      const STALE_THRESHOLD_MS = 5 * 60 * 1000;
      if (lastRecordTime > 0 && Date.now() - lastRecordTime > STALE_THRESHOLD_MS) {
        session.info.status = 'idle';
        this.clearIdleTimer(session);
      }
    }

    this.emitStateChanged();
  }

  private processRecord(file: SessionFile, record: JsonlRecord): void {
    console.log(
      `[ClaudeDashboard:SessionTracker] Record type=${record.type} session=${file.sessionId}`
    );
    // Ensure session exists
    if (!this.sessions.has(file.sessionId)) {
      this.handleNewFile(file);
    }
    const session = this.sessions.get(file.sessionId)!;

    // Update common metadata from any record
    if (record.slug) {
      session.info.slug = record.slug;
      // Use slug as default description for sub-agents
      if (session.info.isSubAgent && !session.description) {
        session.description = record.slug;
      }
    }
    if (record.sessionId && record.sessionId !== file.sessionId && session.info.isSubAgent) {
      session.parentSessionId = record.sessionId;
      session.info.parentSessionId = record.sessionId;
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

  private processAssistant(session: InternalSessionState, record: AssistantRecord): void {
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
      session.info.totalCacheReadTokens += msg.usage.cache_read_input_tokens || 0;
      session.info.totalCacheCreationTokens += msg.usage.cache_creation_input_tokens || 0;
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

  private processUser(session: InternalSessionState, record: UserRecord): void {
    const msg = record.message;
    if (!msg) return;

    // Capture description from first user text in sub-agent sessions (the Task prompt)
    if (session.info.isSubAgent && !session.description) {
      for (const block of msg.content || []) {
        if (block.type === 'text') {
          const textBlock = block as TextContentBlock;
          if (textBlock.text && textBlock.text.trim().length > 0) {
            session.description = textBlock.text.substring(0, 100);
            break;
          }
        }
      }
    }

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

  private processSystem(session: InternalSessionState, record: SystemRecord): void {
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

  private processSummary(session: InternalSessionState, record: SummaryRecord): void {
    if (record.summary) {
      session.info.summary = record.summary;
    } else if (record.message?.content) {
      const content = record.message.content;
      if (typeof content === 'string') {
        session.info.summary = content;
      } else if (Array.isArray(content)) {
        const textBlocks = content.filter((b): b is TextContentBlock => b.type === 'text');
        if (textBlocks.length > 0) {
          session.info.summary = textBlocks.map((b) => b.text).join(' ');
        }
      }
    }
  }

  private processProgress(_session: InternalSessionState, _record: ProgressRecord): void {
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

  private summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
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
      console.log(
        `[ClaudeDashboard:SessionTracker] State changed — ${this.sessions.size} sessions, ${this.activities.length} activities`
      );
      this._onStateChanged.fire();
    }, 100);
  }

  private cleanupStaleSessions(): void {
    console.log(
      `[ClaudeDashboard:SessionTracker] Running stale session cleanup (${this.sessions.size} sessions)`
    );
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, session] of this.sessions) {
      if (
        session.info.status === 'idle' &&
        now - new Date(session.info.lastActivityAt).getTime() > STALE_SESSION_MS
      ) {
        toRemove.push(id);
      }
    }

    if (toRemove.length === 0) return;

    const removeSet = new Set(toRemove);

    // When removing a parent, also remove all its children
    for (const session of this.sessions.values()) {
      if (session.parentSessionId && removeSet.has(session.parentSessionId)) {
        removeSet.add(session.info.sessionId);
      }
    }

    for (const id of removeSet) {
      const session = this.sessions.get(id);
      if (session) {
        this.clearIdleTimer(session);
        this.watcher?.removeTracked(session.info.filePath);
        this.sessions.delete(id);
      }
    }

    this.outputChannel.appendLine(`Cleaned up ${removeSet.size} stale session(s)`);
    this.emitStateChanged();
  }

  /**
   * Clean up all resources: watcher, timers, event emitters, and session state.
   */
  dispose(): void {
    this.watcher?.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    for (const session of this.sessions.values()) {
      this.clearIdleTimer(session);
    }
    this._onStateChanged.dispose();
    this.sessions.clear();
    this.activities.length = 0;
  }
}
