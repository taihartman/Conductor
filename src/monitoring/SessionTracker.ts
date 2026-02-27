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
 * - Inactivity timeout: active sessions (working/thinking) with no new records
 *   for {@link INACTIVITY_TIMEOUT_MS} (10 min) are transitioned to 'done'
 * - Waiting timeout: waiting sessions with no new records for
 *   {@link WAITING_INACTIVITY_TIMEOUT_MS} (2 hours) are transitioned to 'done'
 * - Stale cleanup: terminal-state sessions (idle/done/error) older than
 *   {@link STALE_SESSION_MS} (4 hours) are removed every {@link CLEANUP_INTERVAL_MS} (5 min)
 * - Activity buffer: per-session storage capped at {@link MAX_ACTIVITIES_PER_SESSION} (200) entries with FIFO eviction
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { ProjectScanner } from './ProjectScanner';
import { TranscriptWatcher, WatcherEvent } from './TranscriptWatcher';
import { SessionFile } from './ProjectScanner';
import { SessionStateMachine, ISessionStateMachine } from './SessionStateMachine';
import { HookEventWatcher } from './HookEventWatcher';
import { IHookEventWatcher } from './IHookEventWatcher';
import { ToolStats } from '../analytics/ToolStats';
import { TokenCounter } from '../analytics/TokenCounter';
import { ConversationBuilder } from './ConversationBuilder';
import { ContinuationGrouper } from './ContinuationGrouper';
import { IContinuationGrouper } from './IContinuationGrouper';
import { summarizeToolInput } from '../config/toolSummarizers';
import { ISessionNameResolver } from '../persistence/ISessionNameResolver';
import { SessionNameResolver } from '../persistence/SessionNameResolver';
import {
  LOG_PREFIX,
  TRUNCATION,
  SPECIAL_NAMES,
  SETTINGS,
  ARTIFACT_DETECTION,
  CONTENT_BLOCK_TYPES,
  RECORD_TYPES,
  ACTIVITY_TYPES,
  SESSION_STATUSES,
  STATUS_GROUPS,
  HOOK_EVENTS,
  HOOK_NOTIFICATION_TYPES,
  HOOK_STALENESS_MS,
  HOOK_BUFFER_MAX_EVENTS,
  HOOK_BUFFER_TTL_MS,
} from '../constants';
import {
  JsonlRecord,
  HookEvent,
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
  ConversationTurn,
  SessionStatus,
  ToolUseContentBlock,
  ToolResultContentBlock,
  TextContentBlock,
  normalizeUserContent,
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
  /** Whether we've done the initial async plan title check. */
  planTitleChecked: boolean;
  /** Set to true when a Write to the plans dir is detected, triggering a re-check. */
  pendingPlanCheck: boolean;
  /** True when slug was explicitly set from JSONL data (not the default sessionId prefix). */
  slugIsExplicit: boolean;
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
  conversation: ConversationTurn[];
  toolStats: ToolStatEntry[];
  tokenSummaries: TokenSummary[];
}

/** Maximum activity events stored per session (FIFO eviction). */
const MAX_ACTIVITIES_PER_SESSION = 200;
/**
 * Active sessions (working/thinking) with no new records for this
 * duration are transitioned to 'done'. 10 minutes covers virtually all tool
 * executions; the rare edge case self-heals when a late record arrives.
 */
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * Waiting sessions with no new records for this duration are transitioned
 * to 'done'. 2 hours allows ample time for the user to respond, while
 * preventing indefinite accumulation of abandoned waiting sessions.
 */
const WAITING_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Terminal-state sessions (idle/done/error) older than this are removed from memory. */
const STALE_SESSION_MS = 4 * 60 * 60 * 1000;
/** Interval for the stale session cleanup sweep (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** Records older than this on first file read are considered historical replay. */
const REPLAY_STALE_THRESHOLD_MS = 5 * 60 * 1000;
/** Debounce interval (ms) for batching state change notifications. */
const DEBOUNCE_MS = 100;
/** Maximum activity events sent to the webview in a single state snapshot. */
const MAX_ACTIVITIES_FOR_WEBVIEW = 200;
/** Maximum age of session files considered during manual refresh — matches {@link STALE_SESSION_MS}. */
const REFRESH_WINDOW_MS = 4 * 60 * 60 * 1000;
/** Interval for retrying scope resolution when scoped but empty (30 seconds). */
const SCOPE_RETRY_INTERVAL_MS = 30_000;

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
  private readonly activitiesBySession: Map<string, ActivityEvent[]> = new Map();
  private readonly toolStats: ToolStats = new ToolStats();
  private readonly tokenCounter: TokenCounter = new TokenCounter();
  private readonly conversationBuilder: ConversationBuilder = new ConversationBuilder();
  private readonly continuationGrouper: IContinuationGrouper = new ContinuationGrouper();
  private readonly outputChannel: vscode.OutputChannel;

  private readonly _onStateChanged = new vscode.EventEmitter<void>();
  public readonly onStateChanged = this._onStateChanged.event;

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private scopeRetryTimer?: ReturnType<typeof setInterval>;
  private eventCounter = 0;
  /**
   * `undefined` = unscoped (no workspace context, scan all projects).
   * `[]` = scoped but empty (workspace exists, but Claude project dir doesn't yet).
   * `[dir1, ...]` = scoped to specific directories.
   */
  private scopedProjectDirs: string[] | undefined;
  /** Workspace path stored for scope retry when scoped-but-empty. */
  private readonly workspacePath: string | undefined;
  /** Sessions removed by stale cleanup — prevents zombie resurrection on refresh.
   *  Maps sessionId → removal timestamp (ms) for bounded eviction. */
  private readonly removedSessionIds: Map<string, number> = new Map();
  private readonly nameResolver: ISessionNameResolver;

  // --- Hook event state ---
  private hookWatcher?: IHookEventWatcher;
  private hookEventSubscription?: vscode.Disposable;
  /** Sessions that have received at least one hook event. */
  private readonly hookActiveForSession = new Set<string>();
  /** Timestamp of last hook event per session (for staleness detection). */
  private readonly lastHookEventTime = new Map<string, number>();
  /** Buffer for hook events that arrive before JSONL discovers the session. */
  private readonly pendingHookEvents = new Map<
    string,
    { events: HookEvent[]; firstSeen: number }
  >();

  constructor(
    outputChannel: vscode.OutputChannel,
    workspacePath?: string,
    nameResolver?: ISessionNameResolver
  ) {
    this.outputChannel = outputChannel;
    this.scanner = new ProjectScanner();
    this.nameResolver = nameResolver ?? new SessionNameResolver();
    this.workspacePath = workspacePath;
    this.scopedProjectDirs = this.resolveProjectDirs(workspacePath);
  }

  /**
   * Combine the current workspace with `conductor.additionalWorkspaces` setting,
   * resolve each to its Claude Code project directory, and deduplicate.
   *
   * @param workspacePath - Current VS Code workspace path (first folder)
   * @returns `undefined` when unscoped (no workspace AND no additional workspaces),
   *          `string[]` when scoped (may be empty if dirs don't exist yet)
   */
  private resolveProjectDirs(workspacePath?: string): string[] | undefined {
    const additionalPaths =
      vscode.workspace.getConfiguration().get<string[]>(SETTINGS.ADDITIONAL_WORKSPACES, []) ?? [];

    // No workspace and no additional workspaces → unscoped (scan all projects)
    if (!workspacePath && additionalPaths.length === 0) {
      return undefined;
    }

    // At least one scope source exists → scoped (may be empty if dirs don't exist yet)
    const paths: string[] = [];

    if (workspacePath) {
      const dir = this.scanner.getProjectDirForWorkspace(workspacePath);
      if (dir) {
        paths.push(dir);
      }
    }

    for (const p of additionalPaths) {
      const dir = this.scanner.getProjectDirForWorkspace(p);
      if (dir) {
        paths.push(dir);
      } else {
        const msg = `Additional workspace path "${p}" has no matching Claude Code project directory — skipping`;
        console.log(`${LOG_PREFIX.SESSION_TRACKER} ${msg}`);
        this.outputChannel.appendLine(msg);
      }
    }

    return [...new Set(paths)];
  }

  /**
   * Initialize file watching and start processing transcript records.
   *
   * @remarks
   * Creates the {@link TranscriptWatcher}, starts it, and begins periodic
   * stale session cleanup. Call once after construction.
   */
  start(): void {
    const scope =
      this.scopedProjectDirs === undefined
        ? 'all projects (no workspace)'
        : this.scopedProjectDirs.length > 0
          ? `scoped to ${this.scopedProjectDirs.map((d) => path.basename(d)).join(', ')}`
          : 'scoped but empty (waiting for project dir)';
    console.log(`${LOG_PREFIX.SESSION_TRACKER} Starting session tracking (${scope})...`);
    this.outputChannel.appendLine(`Session tracking scope: ${scope}`);

    this.restartWatcher();
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);

    // When scoped but empty, periodically retry to discover the project dir
    if (this.scopedProjectDirs !== undefined && this.scopedProjectDirs.length === 0) {
      this.startScopeRetry();
    }

    // Hook event watcher — optional, graceful if events dir doesn't exist
    this.startHookWatcher();

    this.outputChannel.appendLine('Session tracking started');
    console.log(`${LOG_PREFIX.SESSION_TRACKER} Session tracking started`);
  }

  /**
   * Initialize the hook event watcher for real-time state updates.
   * Non-fatal: if the events dir doesn't exist yet, the watcher handles it gracefully.
   */
  private startHookWatcher(): void {
    try {
      const eventsDir = path.join(os.homedir(), '.conductor', 'events');
      this.hookWatcher = new HookEventWatcher(eventsDir);
      this.hookEventSubscription = this.hookWatcher.onHookEvents(({ sessionId, events }) => {
        for (const event of events) {
          this.applyHookEvent(sessionId, event);
        }
      });
      this.hookWatcher.start();
      console.log(`${LOG_PREFIX.SESSION_TRACKER} Hook event watcher started`);
    } catch (err) {
      console.log(`${LOG_PREFIX.SESSION_TRACKER} Hook watcher init failed (non-fatal): ${err}`);
    }
  }

  /**
   * Manually re-scan for session files (last 4 hours) and register new ones.
   *
   * @remarks
   * Triggered by the `conductor.refresh` command or the webview
   * `refresh` IPC message. Does not re-read existing tracked files.
   */
  refresh(): void {
    this.outputChannel.appendLine('Manual refresh triggered');
    // Pass scopedProjectDirs directly: undefined → scan all, [] → scan nothing, [dirs] → scan those
    const files = this.scanner.scanSessionFiles(this.scopedProjectDirs, REFRESH_WINDOW_MS);
    let added = 0;
    for (const file of files) {
      if (!this.sessions.has(file.sessionId) && !this.removedSessionIds.has(file.sessionId)) {
        this.handleNewFile(file);
        added++;
      }
    }
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} Refresh: ${files.length} files scanned, ${added} new sessions added`
    );
  }

  /**
   * Return filtered activity events for the webview.
   *
   * @remarks
   * When a parent session is focused, includes activities from its children.
   * When a sub-agent is focused, includes only that agent's activities.
   * Pass `null` or omit to return all activities (unfiltered).
   * Capped at the last {@link MAX_ACTIVITIES_FOR_WEBVIEW} events.
   *
   * @param focusedSessionId - Session to filter by, or `null` for all
   * @returns Filtered activity events for the webview
   */
  getFilteredActivities(focusedSessionId?: string | null): ActivityEvent[] {
    if (!focusedSessionId) {
      // No focus: merge all sessions, sort by timestamp, cap for webview
      const all: ActivityEvent[] = [];
      for (const events of this.activitiesBySession.values()) {
        all.push(...events);
      }
      all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return all.slice(-MAX_ACTIVITIES_FOR_WEBVIEW);
    }

    this.continuationGrouper.ensureFresh(this.sessions);

    const focused = this.sessions.get(focusedSessionId);
    if (focused?.info.isSubAgent) {
      // Sub-agent: return only that agent's activities
      return (this.activitiesBySession.get(focusedSessionId) ?? []).slice(
        -MAX_ACTIVITIES_FOR_WEBVIEW
      );
    }

    // Resolve to primary and get all continuation members
    const primaryId = this.continuationGrouper.getPrimaryId(focusedSessionId);
    const memberIds = this.continuationGrouper.getGroupMembers(primaryId);

    // Collect activities from all continuation members
    const merged: ActivityEvent[] = [];
    for (const memberId of memberIds) {
      merged.push(...(this.activitiesBySession.get(memberId) ?? []));
    }

    // Also merge child sub-agent activities (from any continuation member)
    for (const session of this.sessions.values()) {
      if (!session.info.isSubAgent || !session.parentSessionId) continue;
      const parentPrimary = this.continuationGrouper.getPrimaryId(session.parentSessionId);
      if (parentPrimary === primaryId) {
        merged.push(...(this.activitiesBySession.get(session.info.sessionId) ?? []));
      }
    }

    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged.slice(-MAX_ACTIVITIES_FOR_WEBVIEW);
  }

  /**
   * Return filtered conversation turns for the webview.
   *
   * @param focusedSessionId - Session to filter by, or `null` for none
   * @returns Filtered conversation turns
   */
  getFilteredConversation(focusedSessionId?: string | null): ConversationTurn[] {
    if (!focusedSessionId) return [];

    this.continuationGrouper.ensureFresh(this.sessions);

    // Build session map with parentSessionId resolved through grouper
    const sessionMap = new Map<string, { parentSessionId?: string; isSubAgent: boolean }>();
    for (const [id, session] of this.sessions) {
      const resolvedParent = session.parentSessionId
        ? this.continuationGrouper.getPrimaryId(session.parentSessionId)
        : undefined;
      sessionMap.set(id, {
        parentSessionId: resolvedParent,
        isSubAgent: session.info.isSubAgent,
      });
    }

    // Resolve focused ID to primary
    const primaryId = this.continuationGrouper.getPrimaryId(focusedSessionId);
    const members = this.continuationGrouper.getGroupMembers(primaryId);

    if (members.length > 1) {
      // Multi-member continuation group: use group-aware method
      return this.conversationBuilder.getFilteredConversationForGroup([...members], sessionMap);
    }

    return this.conversationBuilder.getFilteredConversation(primaryId, sessionMap);
  }

  /**
   * Assemble the complete dashboard state snapshot.
   *
   * @remarks
   * Builds a hierarchical session list (parents with nested children + orphaned
   * sub-agents), filters activities by focused session, and collects tool stats
   * and token summaries. Activities are capped at the last 200 events.
   *
   * @param focusedSessionId - Session to filter activities by, or `null` for all
   * @returns Complete {@link DashboardState} for the webview
   */
  getState(focusedSessionId?: string | null): DashboardState {
    // Sync status from state machines to SessionInfo — skip when hooks are active
    for (const [id, session] of this.sessions) {
      if (!this.isHookActive(id)) {
        session.info.status = session.stateMachine.status;
      }
    }

    return {
      sessions: this.assembleSessionList(),
      activities: this.getFilteredActivities(focusedSessionId),
      conversation: this.getFilteredConversation(focusedSessionId),
      toolStats: this.toolStats.getStats(),
      tokenSummaries: this.tokenCounter.getSummaries(),
    };
  }

  /**
   * Determine whether a session is a system-generated artifact that should
   * be auto-hidden by default.
   *
   * @remarks
   * Detection categories (any match → artifact):
   * 1. Episodic-memory plugin sessions (autoName starts with `EPISODIC_MEMORY_PREFIX`)
   * 2. Local-command-caveat system messages (autoName contains `LOCAL_COMMAND_CAVEAT`)
   * 3. Empty completed sessions (0 turns, 0 tokens, terminal status)
   * 4. User-defined patterns from `conductor.autoHidePatterns` (case-insensitive substring)
   *
   * @param session - The session to evaluate
   * @param userPatterns - Pre-filtered, lowercased user patterns from settings
   * @returns `true` if the session is detected as an artifact
   */
  private isSessionArtifact(session: SessionInfo, userPatterns: string[]): boolean {
    if (session.autoName?.startsWith(ARTIFACT_DETECTION.EPISODIC_MEMORY_PREFIX)) {
      return true;
    }
    if (session.autoName?.includes(ARTIFACT_DETECTION.LOCAL_COMMAND_CAVEAT)) {
      return true;
    }
    if (
      session.turnCount === 0 &&
      session.totalInputTokens === 0 &&
      session.totalOutputTokens === 0 &&
      STATUS_GROUPS.COMPLETED.has(session.status)
    ) {
      return true;
    }
    if (userPatterns.length > 0 && session.autoName) {
      const nameLower = session.autoName.toLowerCase();
      if (userPatterns.some((p) => nameLower.includes(p))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build the hierarchical session list with continuation merging,
   * parent-child grouping, and chronological sorting.
   *
   * @remarks
   * Ensures continuation groups are fresh, resolves sub-agent parents through
   * the grouper, deduplicates by primary ID, merges multi-member groups,
   * and attaches child agents. Orphaned sub-agents (parent not tracked)
   * appear as top-level entries.
   *
   * @returns Sorted session list for the webview
   */
  private assembleSessionList(): SessionInfo[] {
    // Read user-defined auto-hide patterns once per assembly (not per-session)
    const rawPatterns: string[] =
      vscode.workspace.getConfiguration().get<string[]>(SETTINGS.AUTO_HIDE_PATTERNS) ?? [];
    const userPatterns = rawPatterns.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0);

    // Ensure continuation groups are fresh
    this.continuationGrouper.ensureFresh(this.sessions);

    // Build parent → children mapping.
    // Sub-agent parentSessionId is resolved through the grouper so children
    // of any continuation member are attached to the merged parent.
    const childrenByParent = new Map<string, SubAgentInfo[]>();
    const orphanedAgents: SessionInfo[] = [];

    for (const session of this.sessions.values()) {
      if (!session.info.isSubAgent) continue;

      const rawParentId = session.parentSessionId;
      // Resolve through grouper: if the parent is a non-primary continuation member,
      // map to the primary so all children appear under the merged session.
      const parentId = rawParentId ? this.continuationGrouper.getPrimaryId(rawParentId) : undefined;

      if (parentId && this.sessions.has(parentId)) {
        const children = childrenByParent.get(parentId) || [];
        children.push({
          sessionId: session.info.sessionId,
          slug: session.info.slug,
          status: session.info.status,
          description: session.description || session.info.autoName || session.info.slug,
          totalInputTokens: session.info.totalInputTokens,
          totalOutputTokens: session.info.totalOutputTokens,
          lastActivityAt: session.info.lastActivityAt,
        });
        childrenByParent.set(parentId, children);
      } else {
        orphanedAgents.push(session.info);
      }
    }

    // Build final sessions list with continuation merging
    const processedPrimaries = new Set<string>();
    const parentSessions: SessionInfo[] = [];

    for (const session of this.sessions.values()) {
      if (session.info.isSubAgent) continue;

      const primaryId = this.continuationGrouper.getPrimaryId(session.info.sessionId);
      if (processedPrimaries.has(primaryId)) continue;
      processedPrimaries.add(primaryId);

      const members = this.continuationGrouper.getGroupMembers(primaryId);
      let sessionInfo: SessionInfo;

      if (members.length > 1) {
        // Merge continuation group
        sessionInfo = this.mergeContinuationGroup([...members]);
      } else {
        sessionInfo = { ...session.info };
      }

      // Attach child agents (from all continuation members)
      sessionInfo.childAgents = childrenByParent.get(primaryId) || [];

      sessionInfo.isArtifact = this.isSessionArtifact(sessionInfo, userPatterns);
      parentSessions.push(sessionInfo);
    }

    // Compute artifact flag for orphaned agents
    for (const agent of orphanedAgents) {
      agent.isArtifact = this.isSessionArtifact(agent, userPatterns);
    }

    return [...parentSessions, ...orphanedAgents].sort((a, b) => {
      const timeDiff = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      return timeDiff !== 0 ? timeDiff : a.sessionId.localeCompare(b.sessionId);
    });
  }

  /**
   * Re-resolve scoped project directories and restart the file watcher if the
   * set changed.
   *
   * @remarks
   * Called when `conductor.additionalWorkspaces` changes at runtime. Sessions
   * already tracked from removed directories are left to expire naturally via
   * inactivity timeout and stale cleanup — no jarring disappearances.
   *
   * @param workspacePath - Current VS Code workspace path (first folder)
   */
  updateScope(workspacePath?: string): void {
    const newDirs = this.resolveProjectDirs(workspacePath);

    // Compare old vs new: both undefined = same, both arrays = compare sets
    const oldIsUndefined = this.scopedProjectDirs === undefined;
    const newIsUndefined = newDirs === undefined;
    if (oldIsUndefined && newIsUndefined) {
      console.log(`${LOG_PREFIX.SESSION_TRACKER} updateScope: no change (both unscoped)`);
      return;
    }
    if (!oldIsUndefined && !newIsUndefined) {
      const oldSet = new Set(this.scopedProjectDirs);
      const newSet = new Set(newDirs);
      if (oldSet.size === newSet.size && [...oldSet].every((d) => newSet.has(d))) {
        console.log(`${LOG_PREFIX.SESSION_TRACKER} updateScope: no change, skipping restart`);
        return;
      }
    }

    const scopeLabel =
      newDirs === undefined
        ? 'all projects'
        : newDirs.length > 0
          ? newDirs.map((d) => path.basename(d)).join(', ')
          : 'scoped but empty';
    console.log(`${LOG_PREFIX.SESSION_TRACKER} updateScope: dirs changed, restarting watcher`);
    this.outputChannel.appendLine(`Scope updated: ${scopeLabel}`);

    this.scopedProjectDirs = newDirs;
    this.stopScopeRetry();

    this.restartWatcher();

    // Start scope retry if scoped but empty
    if (newDirs !== undefined && newDirs.length === 0) {
      this.startScopeRetry();
    }

    // Immediately scan expanded dirs so existing sessions appear without waiting
    this.refresh();
  }

  private createWatcher(): TranscriptWatcher {
    return new TranscriptWatcher(
      this.scanner,
      this.outputChannel,
      (event) => this.handleRecords(event),
      (file) => this.handleNewFile(file),
      this.scopedProjectDirs
    );
  }

  /** Dispose the current watcher (if any) and start a fresh one. */
  private restartWatcher(): void {
    this.watcher?.dispose();
    this.watcher = this.createWatcher();
    this.watcher.start();
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
          status: SESSION_STATUSES.IDLE,
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
          isArtifact: false,
          parentSessionId: file.parentSessionId,
          filePath: file.filePath,
        },
        stateMachine,
        isInitialReplayDone: false,
        parentSessionId: file.parentSessionId,
        description: '',
        planTitleChecked: false,
        pendingPlanCheck: false,
        slugIsExplicit: false,
      });
      this.continuationGrouper.markDirty();

      // Drain any hook events that arrived before JSONL discovered this session
      const pending = this.pendingHookEvents.get(file.sessionId);
      if (pending) {
        this.pendingHookEvents.delete(file.sessionId);
        for (const event of pending.events) {
          this.applyHookEvent(file.sessionId, event);
        }
      }
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
      if (
        lastRecordTime > 0 &&
        Date.now() - lastRecordTime > REPLAY_STALE_THRESHOLD_MS &&
        !this.isHookActive(sessionFile.sessionId)
      ) {
        session.stateMachine.setStatus(SESSION_STATUSES.DONE);
        session.info.status = SESSION_STATUSES.DONE;
      }
    }

    // Async plan title resolution: on first slug arrival or mid-session plan file write
    if (session) {
      const slugIsReal = session.info.slug !== session.info.sessionId.substring(0, 8);
      const needsInitialCheck = !session.planTitleChecked && slugIsReal;
      const needsMidSessionCheck = session.pendingPlanCheck;

      if (slugIsReal && (needsInitialCheck || needsMidSessionCheck)) {
        session.planTitleChecked = true;
        session.pendingPlanCheck = false;
        this.nameResolver.resolveFromPlanFile(session.info.slug).then((planTitle) => {
          if (planTitle) {
            session.info.autoName = planTitle;
            console.log(
              `${LOG_PREFIX.SESSION_TRACKER} Auto-name from plan: "${planTitle}" for ${session.info.slug}`
            );
            this.emitStateChanged();
          }
        });
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
      session.slugIsExplicit = true;
      this.continuationGrouper.markDirty();
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
      case RECORD_TYPES.ASSISTANT:
        this.processAssistant(session, record as AssistantRecord);
        break;
      case RECORD_TYPES.USER:
        this.processUser(session, record as UserRecord);
        break;
      case RECORD_TYPES.SYSTEM:
        this.processSystem(session, record as SystemRecord);
        break;
      case RECORD_TYPES.SUMMARY:
        this.processSummary(session, record as SummaryRecord);
        break;
      case RECORD_TYPES.PROGRESS:
        this.processProgress(session, record as ProgressRecord);
        break;
      case RECORD_TYPES.QUEUE_OPERATION:
      case RECORD_TYPES.FILE_HISTORY_SNAPSHOT:
        // Silently consumed - no UI impact
        break;
    }

    // Sync status from state machine — skip when hooks are actively driving state
    if (!this.isHookActive(file.sessionId)) {
      session.info.status = session.stateMachine.status;
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

    // Process content blocks for activity events
    for (const block of msg.content || []) {
      if (block.type === CONTENT_BLOCK_TYPES.TOOL_USE) {
        const toolBlock = block as ToolUseContentBlock;
        const summarized = summarizeToolInput(toolBlock.name, toolBlock.input);

        // Track last tool for overview display
        session.info.lastToolName = toolBlock.name;
        session.info.lastToolInput = summarized;

        // Detect plan file writes — trigger async plan title resolution
        if (toolBlock.name === SPECIAL_NAMES.WRITE_TOOL) {
          const filePath = toolBlock.input?.file_path as string | undefined;
          if (filePath && this.nameResolver.isPlanFilePath(filePath, session.info.slug)) {
            session.pendingPlanCheck = true;
          }
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
          type: ACTIVITY_TYPES.TOOL_CALL,
          toolName: toolBlock.name,
          toolInput: summarized,
        });
      } else if (block.type === CONTENT_BLOCK_TYPES.TEXT) {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          const truncatedText =
            textBlock.text.length > TRUNCATION.TEXT_MAX
              ? textBlock.text.substring(0, TRUNCATION.TEXT_MAX) + '...'
              : textBlock.text;

          session.info.lastAssistantText = truncatedText;

          this.addActivity({
            id: `evt-${++this.eventCounter}`,
            sessionId: session.info.sessionId,
            sessionSlug: session.info.slug,
            timestamp: record.timestamp || new Date().toISOString(),
            type: ACTIVITY_TYPES.TEXT,
            text: truncatedText,
          });
        }
      }
    }

    // Delegate status transition to state machine
    session.stateMachine.handleAssistantRecord(record);

    // Sync pendingQuestion from state machine
    session.info.pendingQuestion = session.stateMachine.pendingQuestion;

    // Apply tool input summarization for tool approval display
    if (session.info.pendingQuestion?.isToolApproval && session.info.pendingQuestion.pendingTools) {
      session.info.pendingQuestion = {
        ...session.info.pendingQuestion,
        pendingTools: session.info.pendingQuestion.pendingTools.map((t) => ({
          toolName: t.toolName,
          inputSummary: summarizeToolInput(
            t.toolName,
            (t as unknown as { input: Record<string, unknown> }).input ?? {}
          ),
        })),
      };
    }

    // Track turn count on end_turn with no tool_use
    const hasToolUse = (msg.content || []).some((b) => b.type === CONTENT_BLOCK_TYPES.TOOL_USE);
    if (msg.stop_reason === SPECIAL_NAMES.END_TURN_STOP_REASON && !hasToolUse) {
      session.info.turnCount++;
    }

    this.conversationBuilder.processAssistant(session.info.sessionId, record);
  }

  private processUser(session: InternalSessionState, record: UserRecord): void {
    const msg = record.message;
    if (!msg) return;

    const blocks = normalizeUserContent(msg.content);

    // Capture first user text as auto-name for ALL sessions
    if (!session.info.autoName) {
      for (const block of blocks) {
        if (block.type === CONTENT_BLOCK_TYPES.TEXT) {
          const textBlock = block as TextContentBlock;
          if (textBlock.text && textBlock.text.trim().length > 0) {
            session.info.autoName = this.nameResolver.resolveFromPrompt(textBlock.text);
            console.log(
              `${LOG_PREFIX.SESSION_TRACKER} Auto-name from prompt: "${session.info.autoName}" for ${session.info.slug}`
            );
            // Backward compat: also set description for sub-agent display
            // Overwrite when description is empty or just the slug (set by metadata handler)
            if (
              session.info.isSubAgent &&
              (!session.description || session.description === session.info.slug)
            ) {
              session.description = session.info.autoName;
            }
            break;
          }
        }
      }
    }

    for (const block of blocks) {
      if (block.type === CONTENT_BLOCK_TYPES.TOOL_RESULT) {
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
              .filter((c) => c.type === CONTENT_BLOCK_TYPES.TEXT && c.text)
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
          type: ACTIVITY_TYPES.TOOL_RESULT,
          isError: resultBlock.is_error,
          errorMessage,
        });
      } else if (block.type === CONTENT_BLOCK_TYPES.TEXT) {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          this.addActivity({
            id: `evt-${++this.eventCounter}`,
            sessionId: session.info.sessionId,
            sessionSlug: session.info.slug,
            timestamp: record.timestamp || new Date().toISOString(),
            type: ACTIVITY_TYPES.USER_INPUT,
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

    // Sync pendingQuestion from state machine (tool_result clears tool approval)
    session.info.pendingQuestion = session.stateMachine.pendingQuestion;

    this.conversationBuilder.processUser(session.info.sessionId, record);
  }

  private processSystem(session: InternalSessionState, record: SystemRecord): void {
    if (record.subtype === SPECIAL_NAMES.TURN_DURATION_SUBTYPE) {
      session.info.turnCount++;

      this.addActivity({
        id: `evt-${++this.eventCounter}`,
        sessionId: session.info.sessionId,
        sessionSlug: session.info.slug,
        timestamp: record.timestamp || new Date().toISOString(),
        type: ACTIVITY_TYPES.TURN_END,
        durationMs: record.durationMs,
      });
    }

    // Delegate status transition to state machine
    session.stateMachine.handleSystemRecord(record);

    // Sync pendingQuestion from state machine (stop_hook_summary clears it on DONE)
    session.info.pendingQuestion = session.stateMachine.pendingQuestion;

    this.conversationBuilder.processSystem(session.info.sessionId, record);
  }

  private processSummary(session: InternalSessionState, record: SummaryRecord): void {
    if (record.summary) {
      session.info.summary = record.summary;
    } else if (record.message?.content) {
      const content = record.message.content;
      if (typeof content === 'string') {
        session.info.summary = content;
      } else if (Array.isArray(content)) {
        const textBlocks = content.filter(
          (b): b is TextContentBlock => b.type === CONTENT_BLOCK_TYPES.TEXT
        );
        if (textBlocks.length > 0) {
          session.info.summary = textBlocks.map((b) => b.text).join(' ');
        }
      }
    }

    this.conversationBuilder.processSummary(session.info.sessionId, record);
  }

  private processProgress(session: InternalSessionState, record: ProgressRecord): void {
    session.stateMachine.handleProgressRecord(record);
  }

  /**
   * Resolve a session ID to the most recent active member of its continuation group.
   * Used by DashboardPanel to route terminal input to the right session.
   *
   * @param sessionId - Any session ID (may be primary or non-primary member)
   * @returns The most recently active member's session ID
   */
  getMostRecentContinuationMember(sessionId: string): string {
    this.continuationGrouper.ensureFresh(this.sessions);
    const primaryId = this.continuationGrouper.getPrimaryId(sessionId);
    return this.continuationGrouper.getMostRecentMember(primaryId, this.sessions);
  }

  /**
   * Get all member IDs in the continuation group that contains the given session.
   * Used by DashboardPanel to find a launched terminal within a continuation group.
   *
   * @param sessionId - Any session ID (may be primary or non-primary member)
   * @returns Ordered list of member session IDs (earliest first)
   */
  getGroupMembers(sessionId: string): readonly string[] {
    this.continuationGrouper.ensureFresh(this.sessions);
    const primaryId = this.continuationGrouper.getPrimaryId(sessionId);
    return this.continuationGrouper.getGroupMembers(primaryId);
  }

  /**
   * Get all session IDs that are members of continuation groups.
   * Used by DashboardPanel to include member IDs as "live" during stale ID pruning,
   * preventing incorrect removal of hidden IDs that map to merged-away members.
   *
   * @returns Set of all continuation group member IDs
   */
  getContinuationMemberIds(): Set<string> {
    this.continuationGrouper.ensureFresh(this.sessions);
    const memberIds = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.info.isSubAgent) continue;
      const primaryId = this.continuationGrouper.getPrimaryId(session.info.sessionId);
      const members = this.continuationGrouper.getGroupMembers(primaryId);
      for (const memberId of members) {
        memberIds.add(memberId);
      }
    }
    return memberIds;
  }

  /**
   * Merge multiple continuation sessions into a single SessionInfo for display.
   *
   * @param memberIds - Ordered list of session IDs (earliest first)
   * @returns Merged SessionInfo with aggregated tokens, turns, and metadata
   */
  private mergeContinuationGroup(memberIds: string[]): SessionInfo {
    const primary = this.sessions.get(memberIds[0])!;
    const mostRecentId = this.continuationGrouper.getMostRecentMember(memberIds[0], this.sessions);
    const mostRecent = this.sessions.get(mostRecentId)!;

    // Aggregate token counts across all members
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let turnCount = 0;
    let earliestStart = primary.info.startedAt;
    let latestActivity = primary.info.lastActivityAt;
    let pendingQuestion = primary.info.pendingQuestion;

    // Resolve names: check primary first, then fall through to later members
    let autoName = primary.info.autoName;
    let customName = primary.info.customName;

    for (const memberId of memberIds) {
      const member = this.sessions.get(memberId);
      if (!member) continue;

      totalInputTokens += member.info.totalInputTokens;
      totalOutputTokens += member.info.totalOutputTokens;
      totalCacheReadTokens += member.info.totalCacheReadTokens;
      totalCacheCreationTokens += member.info.totalCacheCreationTokens;
      turnCount += member.info.turnCount;

      if (member.info.startedAt < earliestStart) {
        earliestStart = member.info.startedAt;
      }
      if (member.info.lastActivityAt > latestActivity) {
        latestActivity = member.info.lastActivityAt;
      }

      // Fall through name resolution: first non-empty wins
      if (!autoName && member.info.autoName) {
        autoName = member.info.autoName;
      }
      if (!customName && member.info.customName) {
        customName = member.info.customName;
      }

      // Pending question from any waiting member
      if (!pendingQuestion && member.info.pendingQuestion) {
        pendingQuestion = member.info.pendingQuestion;
      }
    }

    return {
      sessionId: primary.info.sessionId,
      slug: primary.info.slug,
      summary: mostRecent.info.summary,
      status: mostRecent.info.status,
      model: mostRecent.info.model,
      gitBranch: mostRecent.info.gitBranch || primary.info.gitBranch,
      cwd: primary.info.cwd,
      startedAt: earliestStart,
      lastActivityAt: latestActivity,
      turnCount,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      isSubAgent: false,
      isArtifact: false, // computed in assembleSessionList() after merge
      filePath: primary.info.filePath,
      autoName,
      customName,
      lastToolName: mostRecent.info.lastToolName,
      lastToolInput: mostRecent.info.lastToolInput,
      lastAssistantText: mostRecent.info.lastAssistantText,
      pendingQuestion,
      continuationSessionIds: memberIds,
      continuationCount: memberIds.length - 1,
      launchedByConductor: primary.info.launchedByConductor,
    };
  }

  private addActivity(event: ActivityEvent): void {
    let sessionActivities = this.activitiesBySession.get(event.sessionId);
    if (!sessionActivities) {
      sessionActivities = [];
      this.activitiesBySession.set(event.sessionId, sessionActivities);
    }
    sessionActivities.push(event);
    if (sessionActivities.length > MAX_ACTIVITIES_PER_SESSION) {
      sessionActivities.splice(0, sessionActivities.length - MAX_ACTIVITIES_PER_SESSION);
    }
  }

  private emitStateChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      let totalActivities = 0;
      for (const events of this.activitiesBySession.values()) {
        totalActivities += events.length;
      }
      console.log(
        `${LOG_PREFIX.SESSION_TRACKER} State changed — ${this.sessions.size} sessions, ${totalActivities} activities`
      );
      this._onStateChanged.fire();
    }, DEBOUNCE_MS);
  }

  // =========================================================================
  // Hook event integration
  // =========================================================================

  /**
   * Apply a hook event to update session state.
   * If the session doesn't exist yet (JSONL not discovered), buffers the event.
   *
   * @param sessionId - Session ID from the hook event filename
   * @param event - The parsed hook event
   */
  private applyHookEvent(sessionId: string, event: HookEvent): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      // Session not yet discovered via JSONL — buffer the event
      let buffer = this.pendingHookEvents.get(sessionId);
      if (!buffer) {
        buffer = { events: [], firstSeen: Date.now() };
        this.pendingHookEvents.set(sessionId, buffer);
      }
      if (buffer.events.length < HOOK_BUFFER_MAX_EVENTS) {
        buffer.events.push(event);
      }
      return;
    }

    this.hookActiveForSession.add(sessionId);
    this.lastHookEventTime.set(sessionId, Date.now());

    const status = this.mapHookEventToStatus(event);
    if (status) {
      session.stateMachine.overrideStatus(status);
      session.info.status = status;
    }

    // Update lastActivityAt to prevent inactivity timeout from overriding
    session.info.lastActivityAt = new Date(event.ts * 1000).toISOString();

    // Track tool errors for error state threshold
    if (event.e === HOOK_EVENTS.POST_TOOL_USE_FAILURE) {
      session.stateMachine.recordHookError(event.tool || 'unknown');
      if (session.stateMachine.recentErrorCount >= 3) {
        session.stateMachine.overrideStatus(SESSION_STATUSES.ERROR);
        session.info.status = SESSION_STATUSES.ERROR;
      }
    }

    this.emitStateChanged();
  }

  /**
   * Map a hook event to a session status.
   * Returns null for events that don't directly map to a status change.
   *
   * @param event - The hook event to map
   * @returns The corresponding session status, or null if unmapped
   */
  private mapHookEventToStatus(event: HookEvent): SessionStatus | null {
    switch (event.e) {
      case HOOK_EVENTS.SESSION_START:
      case HOOK_EVENTS.USER_PROMPT_SUBMIT:
      case HOOK_EVENTS.PRE_TOOL_USE:
      case HOOK_EVENTS.POST_TOOL_USE:
      case HOOK_EVENTS.SUBAGENT_START:
      case HOOK_EVENTS.PRE_COMPACT:
        return SESSION_STATUSES.WORKING;

      case HOOK_EVENTS.PERMISSION_REQUEST:
        return SESSION_STATUSES.WAITING;

      case HOOK_EVENTS.NOTIFICATION:
        if (
          event.ntype === HOOK_NOTIFICATION_TYPES.IDLE_PROMPT ||
          event.ntype === HOOK_NOTIFICATION_TYPES.PERMISSION_PROMPT
        ) {
          return SESSION_STATUSES.WAITING;
        }
        return null;

      case HOOK_EVENTS.STOP:
        return SESSION_STATUSES.DONE;

      case HOOK_EVENTS.SESSION_END:
        return SESSION_STATUSES.IDLE;

      case HOOK_EVENTS.POST_TOOL_USE_FAILURE:
        return null; // Error tracking handled via threshold above

      default:
        return null;
    }
  }

  /**
   * Whether hook events are actively driving state for this session.
   * Returns false if hooks have never fired or are stale (>60s since last event).
   *
   * @param sessionId - The session to check
   * @returns True if hooks are actively driving state for this session
   */
  private isHookActive(sessionId: string): boolean {
    if (!this.hookActiveForSession.has(sessionId)) return false;
    const lastTime = this.lastHookEventTime.get(sessionId);
    if (!lastTime) return false;
    if (Date.now() - lastTime > HOOK_STALENESS_MS) {
      // Hooks went stale — fall back to JSONL
      this.hookActiveForSession.delete(sessionId);
      this.lastHookEventTime.delete(sessionId);
      return false;
    }
    return true;
  }

  private cleanupStaleSessions(): void {
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} Running stale session cleanup (${this.sessions.size} sessions)`
    );
    const now = Date.now();
    let changed = false;

    // Pass 1: Inactivity timeout — transition stale working/thinking sessions to 'done'.
    // Only STATUS_GROUPS.ACTIVE (working, thinking) — NOT waiting. Waiting sessions
    // are legitimately alive (Claude is asking the user a question) and get their own
    // longer timeout in Pass 1b.
    // Sessions in 'error' are excluded: they go straight to removal in Pass 2
    // so the error state remains visible in the dashboard until then.
    const freshlyTransitioned = new Set<string>();
    for (const [id, session] of this.sessions) {
      const status = session.stateMachine.status;
      if (
        STATUS_GROUPS.ACTIVE.has(status) &&
        now - new Date(session.info.lastActivityAt).getTime() > INACTIVITY_TIMEOUT_MS
      ) {
        session.stateMachine.setStatus(SESSION_STATUSES.DONE);
        session.info.status = SESSION_STATUSES.DONE;
        freshlyTransitioned.add(id);
        console.log(`${LOG_PREFIX.SESSION_TRACKER} Inactivity timeout: ${id} → done`);
        this.outputChannel.appendLine(
          `Session ${session.info.slug} marked done (working/thinking inactive for >10 min)`
        );
        changed = true;
      }
    }

    // Pass 1b: Stale waiting sessions — waiting sessions abandoned for >2 hours.
    // Without this, waiting sessions that are never answered would accumulate forever.
    for (const [id, session] of this.sessions) {
      if (
        session.stateMachine.status === SESSION_STATUSES.WAITING &&
        now - new Date(session.info.lastActivityAt).getTime() > WAITING_INACTIVITY_TIMEOUT_MS
      ) {
        session.stateMachine.setStatus(SESSION_STATUSES.DONE);
        session.info.status = SESSION_STATUSES.DONE;
        freshlyTransitioned.add(id);
        console.log(`${LOG_PREFIX.SESSION_TRACKER} Waiting timeout: ${id} → done`);
        this.outputChannel.appendLine(
          `Session ${session.info.slug} marked done (waiting inactive for >2 hours)`
        );
        changed = true;
      }
    }

    // Pass 2: Stale removal — remove terminal-state sessions from memory
    // Ensure continuation groups are fresh for group-aware checks
    this.continuationGrouper.ensureFresh(this.sessions);

    const toRemove = new Set<string>();
    for (const [id, session] of this.sessions) {
      // Guard: never remove sessions freshly transitioned in this same cycle
      if (freshlyTransitioned.has(id)) continue;

      const status = session.stateMachine.status;
      if (
        (STATUS_GROUPS.COMPLETED.has(status) || status === SESSION_STATUSES.ERROR) &&
        now - new Date(session.info.lastActivityAt).getTime() > STALE_SESSION_MS
      ) {
        // If this session belongs to a continuation group, skip removal if any
        // group member is still active (the group lives as long as its newest member).
        if (this.continuationGrouper.isGrouped(id)) {
          const primaryId = this.continuationGrouper.getPrimaryId(id);
          const members = this.continuationGrouper.getGroupMembers(primaryId);
          const anyMemberActive = members.some((memberId) => {
            const member = this.sessions.get(memberId);
            if (!member) return false;
            return STATUS_GROUPS.ACTIVE_FILTER.has(member.stateMachine.status);
          });
          if (anyMemberActive) continue;
        }
        toRemove.add(id);
      }
    }

    // Cascade: remove children of removed parents (resolved through grouper)
    for (const session of this.sessions.values()) {
      if (!session.parentSessionId) continue;
      const resolvedParent = this.continuationGrouper.getPrimaryId(session.parentSessionId);
      if (toRemove.has(resolvedParent)) {
        toRemove.add(session.info.sessionId);
      }
    }

    for (const id of toRemove) {
      const session = this.sessions.get(id);
      if (session) {
        session.stateMachine.dispose();
        this.watcher?.removeTracked(session.info.filePath);
        this.sessions.delete(id);
        this.activitiesBySession.delete(id);
        this.conversationBuilder.clearSession(id);
        this.removedSessionIds.set(id, now);
      }
    }

    if (toRemove.size > 0) {
      this.continuationGrouper.markDirty();
      this.outputChannel.appendLine(`Cleaned up ${toRemove.size} stale session(s)`);
      changed = true;
    }

    // Evict removedSessionIds entries older than REFRESH_WINDOW_MS
    const removalCutoff = now - REFRESH_WINDOW_MS;
    for (const [id, removedAt] of this.removedSessionIds) {
      if (removedAt < removalCutoff) {
        this.removedSessionIds.delete(id);
      }
    }

    // Evict stale pending hook event buffers (sessions that never appeared via JSONL)
    for (const [sid, buffer] of this.pendingHookEvents) {
      if (now - buffer.firstSeen > HOOK_BUFFER_TTL_MS) {
        this.pendingHookEvents.delete(sid);
      }
    }

    if (changed) {
      this.emitStateChanged();
    }
  }

  /**
   * Start periodic retries to discover the Claude project dir when scoped-but-empty.
   * Once the dir appears (user runs Claude Code in this workspace), restart the watcher.
   */
  private startScopeRetry(): void {
    this.stopScopeRetry();
    console.log(
      `${LOG_PREFIX.SESSION_TRACKER} Starting scope retry (every ${SCOPE_RETRY_INTERVAL_MS / 1000}s)`
    );
    this.scopeRetryTimer = setInterval(() => {
      const newDirs = this.resolveProjectDirs(this.workspacePath);
      if (newDirs !== undefined && newDirs.length > 0) {
        console.log(
          `${LOG_PREFIX.SESSION_TRACKER} Scope retry succeeded — found ${newDirs.length} dir(s)`
        );
        this.outputChannel.appendLine(
          `Project dir discovered: ${newDirs.map((d) => path.basename(d)).join(', ')}`
        );
        this.scopedProjectDirs = newDirs;
        this.stopScopeRetry();

        this.restartWatcher();
        this.refresh();
      }
    }, SCOPE_RETRY_INTERVAL_MS);
  }

  private stopScopeRetry(): void {
    if (this.scopeRetryTimer) {
      clearInterval(this.scopeRetryTimer);
      this.scopeRetryTimer = undefined;
    }
  }

  /**
   * Clean up all resources: watcher, timers, event emitters, and session state.
   */
  dispose(): void {
    this.hookEventSubscription?.dispose();
    this.hookWatcher?.dispose();
    this.watcher?.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.stopScopeRetry();
    for (const session of this.sessions.values()) {
      session.stateMachine.dispose();
    }
    this.conversationBuilder.dispose();
    this._onStateChanged.dispose();
    this.sessions.clear();
    this.activitiesBySession.clear();
    this.removedSessionIds.clear();
    this.hookActiveForSession.clear();
    this.lastHookEventTime.clear();
    this.pendingHookEvents.clear();
  }
}
