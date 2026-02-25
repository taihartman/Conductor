/**
 * @module SessionTracker
 *
 * Core orchestrator that maps session IDs to state, processes JSONL records,
 * and emits debounced state updates to the dashboard.
 *
 * @remarks
 * Status transitions are delegated to {@link SessionStateMachine} instances
 * (one per session). This class owns record routing, metadata extraction,
 * activity creation, analytics delegation, and hierarchy building.
 *
 * **Key behaviors:**
 * - Debounced updates: state changes are batched and emitted after 100ms of quiet
 * - Replay detection: records older than 5 minutes on first file read are marked historical
 * - Stale cleanup: idle sessions older than {@link STALE_SESSION_MS} (4h) are removed
 *   every {@link CLEANUP_INTERVAL_MS} (5min)
 * - Activity buffer: capped at {@link MAX_ACTIVITIES} (500) entries with FIFO eviction
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectScanner } from './ProjectScanner';
import { TranscriptWatcher, WatcherEvent } from './TranscriptWatcher';
import { SessionFile } from './ProjectScanner';
import { SessionStateMachine, ISessionStateMachine } from './SessionStateMachine';
import { ToolStats } from '../analytics/ToolStats';
import { TokenCounter } from '../analytics/TokenCounter';
import { summarizeToolInput } from '../config/toolSummarizers';
import { LOG_PREFIX, TRUNCATION, SPECIAL_NAMES } from '../constants';
import {
  JsonlRecord,
  AssistantRecord,
  UserRecord,
  SystemRecord,
  SummaryRecord,
  ProgressRecord,
  SessionInfo,
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
  /** State machine owning status transitions and timers. */
  stateMachine: ISessionStateMachine;
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

/** Maximum number of activity events kept in the buffer (FIFO eviction). */
const MAX_ACTIVITIES = 500;
/** Sessions idle longer than this (4 hours) are eligible for cleanup. */
const STALE_SESSION_MS = 4 * 60 * 60 * 1000;
/** Interval for the stale session cleanup sweep (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** Records older than this on first file read are considered historical replay. */
const REPLAY_STALE_THRESHOLD_MS = 5 * 60 * 1000;
/** Debounce interval (ms) for batching state change notifications. */
const DEBOUNCE_MS = 100;
/** Maximum activity events sent to the webview in a single state snapshot. */
const MAX_ACTIVITIES_FOR_WEBVIEW = 200;
/** Maximum age of session files considered during manual refresh (24 hours). */
const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Core session orchestrator that processes JSONL records into dashboard state.
 *
 * @remarks
 * Owns a {@link ProjectScanner}, {@link TranscriptWatcher}, {@link ToolStats},
 * and {@link TokenCounter}. Delegates status transitions to per-session
 * {@link SessionStateMachine} instances. Implements `vscode.Disposable` for
 * cleanup of all timers, watchers, and event emitters.
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
  private readonly scopedProjectDir?: string;

  constructor(outputChannel: vscode.OutputChannel, workspacePath?: string) {
    this.outputChannel = outputChannel;
    this.scanner = new ProjectScanner();

    if (workspacePath) {
      this.scopedProjectDir = this.scanner.getProjectDirForWorkspace(workspacePath);
    }
  }

  /**
   * Initialize file watching and start processing transcript records.
   *
   * @remarks
   * Creates the {@link TranscriptWatcher}, starts it, and begins periodic
   * stale session cleanup. Call once after construction.
   */
  start(): void {
    const scope = this.scopedProjectDir
      ? `scoped to ${path.basename(this.scopedProjectDir)}`
      : 'all projects (no workspace)';
    console.log(`${LOG_PREFIX.SESSION_TRACKER} Starting session tracking (${scope})...`);
    this.outputChannel.appendLine(`Session tracking scope: ${scope}`);

    this.watcher = new TranscriptWatcher(
      this.scanner,
      this.outputChannel,
      (event) => this.handleRecords(event),
      (file) => this.handleNewFile(file),
      this.scopedProjectDir
    );
    this.watcher.start();
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
    this.outputChannel.appendLine('Session tracking started');
    console.log(`${LOG_PREFIX.SESSION_TRACKER} Session tracking started`);
  }

  /**
   * Manually re-scan for session files (last 24 hours) and register new ones.
   *
   * @remarks
   * Triggered by the `conductor.refresh` command or the webview
   * `refresh` IPC message. Does not re-read existing tracked files.
   */
  refresh(): void {
    this.outputChannel.appendLine('Manual refresh triggered');
    const files = this.scanner.scanSessionFiles(this.scopedProjectDir, REFRESH_WINDOW_MS);
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
    // Sync status from state machines to SessionInfo
    for (const session of this.sessions.values()) {
      session.info.status = session.stateMachine.status;
    }

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
      activities: activities.slice(-MAX_ACTIVITIES_FOR_WEBVIEW),
      toolStats: this.toolStats.getStats(),
      tokenSummaries: this.tokenCounter.getSummaries(),
    };
  }

  private handleNewFile(file: SessionFile): void {
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} New file: ${file.sessionId} (subAgent=${file.isSubAgent})`
    );
    if (!this.sessions.has(file.sessionId)) {
      const stateMachine = new SessionStateMachine(() => this.emitStateChanged());
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
        stateMachine,
        isInitialReplayDone: false,
        parentSessionId: file.parentSessionId,
        description: '',
      });
    }
  }

  private handleRecords(event: WatcherEvent): void {
    const { sessionFile, records } = event;
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} Processing ${records.length} record(s) for session ${sessionFile.sessionId}`
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
      if (lastRecordTime > 0 && Date.now() - lastRecordTime > REPLAY_STALE_THRESHOLD_MS) {
        session.stateMachine.setStatus('done');
        session.info.status = 'done';
      }
    }

    this.emitStateChanged();
  }

  private processRecord(file: SessionFile, record: JsonlRecord): void {
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} Record type=${record.type} session=${file.sessionId}`
    );
    // Ensure session exists
    if (!this.sessions.has(file.sessionId)) {
      this.handleNewFile(file);
    }
    const session = this.sessions.get(file.sessionId)!;

    // Update common metadata from any record
    if (record.slug) {
      session.info.slug = record.slug;
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

    // Sync status from state machine
    session.info.status = session.stateMachine.status;
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

    // Process content blocks for activity events
    for (const block of msg.content || []) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseContentBlock;
        const summarized = summarizeToolInput(toolBlock.name, toolBlock.input);

        // Track last tool for overview display
        session.info.lastToolName = toolBlock.name;
        session.info.lastToolInput = summarized;

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
          toolInput: summarized,
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
              textBlock.text.length > TRUNCATION.TEXT_MAX
                ? textBlock.text.substring(0, TRUNCATION.TEXT_MAX) + '...'
                : textBlock.text,
          });
        }
      }
    }

    // Delegate status transition to state machine
    session.stateMachine.handleAssistantRecord(record);

    // Sync pendingQuestion from state machine
    session.info.pendingQuestion = session.stateMachine.pendingQuestion;

    // Track turn count on end_turn with no tool_use
    const hasToolUse = (msg.content || []).some((b) => b.type === 'tool_use');
    if (msg.stop_reason === SPECIAL_NAMES.END_TURN_STOP_REASON && !hasToolUse) {
      session.info.turnCount++;
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
            session.description = textBlock.text.substring(0, TRUNCATION.DESCRIPTION_MAX);
            break;
          }
        }
      }
    }

    for (const block of msg.content || []) {
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultContentBlock;

        this.toolStats.recordToolResult(
          resultBlock.tool_use_id,
          resultBlock.is_error || false,
          record.timestamp || new Date().toISOString()
        );

        // Extract error message for display
        let errorMessage: string | undefined;
        if (resultBlock.is_error && resultBlock.content) {
          if (typeof resultBlock.content === 'string') {
            errorMessage = resultBlock.content.substring(0, TRUNCATION.ERROR_MESSAGE_MAX);
          } else if (Array.isArray(resultBlock.content)) {
            const text = resultBlock.content
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text)
              .join(' ');
            errorMessage = text.substring(0, TRUNCATION.ERROR_MESSAGE_MAX) || undefined;
          }
        }

        this.addActivity({
          id: `evt-${++this.eventCounter}`,
          sessionId: session.info.sessionId,
          sessionSlug: session.info.slug,
          timestamp: record.timestamp || new Date().toISOString(),
          type: 'tool_result',
          isError: resultBlock.is_error,
          errorMessage,
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
              textBlock.text.length > TRUNCATION.TEXT_MAX
                ? textBlock.text.substring(0, TRUNCATION.TEXT_MAX) + '...'
                : textBlock.text,
          });
        }
      }
    }

    // Delegate status transition to state machine
    session.stateMachine.handleUserRecord(record);
  }

  private processSystem(session: InternalSessionState, record: SystemRecord): void {
    if (record.subtype === SPECIAL_NAMES.TURN_DURATION_SUBTYPE) {
      session.info.turnCount++;

      this.addActivity({
        id: `evt-${++this.eventCounter}`,
        sessionId: session.info.sessionId,
        sessionSlug: session.info.slug,
        timestamp: record.timestamp || new Date().toISOString(),
        type: 'turn_end',
        durationMs: record.durationMs,
      });
    }

    // Delegate status transition to state machine
    session.stateMachine.handleSystemRecord(record);
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

  private processProgress(session: InternalSessionState, record: ProgressRecord): void {
    session.stateMachine.handleProgressRecord(record);
  }

  private addActivity(event: ActivityEvent): void {
    this.activities.push(event);
    if (this.activities.length > MAX_ACTIVITIES) {
      this.activities.splice(0, this.activities.length - MAX_ACTIVITIES);
    }
  }

  private emitStateChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      console.log(
        `${LOG_PREFIX.SESSION_TRACKER} State changed — ${this.sessions.size} sessions, ${this.activities.length} activities`
      );
      this._onStateChanged.fire();
    }, DEBOUNCE_MS);
  }

  private cleanupStaleSessions(): void {
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} Running stale session cleanup (${this.sessions.size} sessions)`
    );
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, session] of this.sessions) {
      const status = session.stateMachine.status;
      if (
        (status === 'idle' || status === 'done' || status === 'error' || status === 'waiting') &&
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
        session.stateMachine.dispose();
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
      session.stateMachine.dispose();
    }
    this._onStateChanged.dispose();
    this.sessions.clear();
    this.activities.length = 0;
  }
}
