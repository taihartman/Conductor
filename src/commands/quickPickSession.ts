/**
 * @module quickPickSession
 *
 * Command handler for `conductor.quickPickSession` — a keyboard-driven Quick Pick
 * that lets users switch between monitored Claude Code sessions.
 *
 * @remarks
 * Exports several pure helper functions (`sortSessionsByUrgency`, `resolveDisplayName`,
 * `relativeTime`, `buildQuickPickItems`) alongside the async command handler.
 * The pure functions are tested directly without requiring a VS Code environment.
 */

import * as vscode from 'vscode';
import type { SessionTracker } from '../monitoring/SessionTracker';
import type { SessionInfo, SessionStatus } from '../models/types';
import { DashboardPanel } from '../DashboardPanel';
import { LOG_PREFIX, QUICK_PICK_STRINGS } from '../constants';
import type { ISessionNameStore } from '../persistence/ISessionNameStore';
import type { ISessionVisibilityStore } from '../persistence/ISessionVisibilityStore';
import type { ISessionOrderStore } from '../persistence/ISessionOrderStore';
import type { ISessionLauncher } from '../terminal/ISessionLauncher';
import type { IPtyBridge } from '../terminal/IPtyBridge';
import type { ILaunchedSessionStore } from '../persistence/ILaunchedSessionStore';
import type { ISessionHistoryStore } from '../persistence/ISessionHistoryStore';
import type { ISessionHistoryService } from '../persistence/ISessionHistoryService';
import type { IStatsCacheReader } from '../persistence/StatsCacheReader';
import type { ITileLayoutStore } from '../persistence/ITileLayoutStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Quick Pick item with an optional sessionId for identifying which session was selected. */
export interface SessionQuickPickItem extends vscode.QuickPickItem {
  sessionId?: string;
}

/**
 * Dependencies needed by DashboardPanel.createOrShow that are forwarded
 * through the Quick Pick handler.
 */
export interface CreateOrShowDeps {
  orderStore: ISessionOrderStore;
  sessionLauncher: ISessionLauncher;
  ptyBridge: IPtyBridge;
  launchedSessionStore: ILaunchedSessionStore;
  sessionHistoryStore: ISessionHistoryStore;
  sessionHistoryService: ISessionHistoryService;
  statsCacheReader: IStatsCacheReader;
  tileLayoutStore: ITileLayoutStore;
}

// ---------------------------------------------------------------------------
// Status priority (lower number = higher urgency)
// ---------------------------------------------------------------------------

/** Priority order for sorting sessions by status urgency. Lower values appear first. */
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  error: 1,
  working: 2,
  thinking: 3,
  done: 4,
  idle: 5,
} as const;

/** Codicon icon strings for each session status. */
const STATUS_ICONS: Record<SessionStatus, string> = {
  waiting: '$(bell)',
  error: '$(alert)',
  working: '$(pulse)',
  thinking: '$(pulse)',
  done: '$(check)',
  idle: '$(circle-filled)',
} as const;

/** Human-readable group labels used as Quick Pick separators — aligned with Kanban column names. */
const STATUS_GROUP_LABELS: Record<SessionStatus, string> = {
  waiting: 'Awaiting Input',
  error: 'Needs Attention',
  working: 'Performing',
  thinking: 'Performing',
  done: 'Completed',
  idle: 'Completed',
} as const;

// ---------------------------------------------------------------------------
// Time formatting constants
// ---------------------------------------------------------------------------

/** Milliseconds per second. */
const MS_PER_SECOND = 1_000;
/** Milliseconds per minute. */
const MS_PER_MINUTE = 60_000;
/** Milliseconds per hour. */
const MS_PER_HOUR = 3_600_000;
/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Sort sessions by status urgency, then by most recent activity within the same group.
 *
 * @param sessions - Array of sessions to sort
 * @returns New sorted array (does not mutate the input)
 */
export function sortSessionsByUrgency(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) return priorityDiff;
    // Within same priority, most recent activity first
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

/**
 * Resolve the display name for a session, preferring customName over autoName over sessionId.
 *
 * @param session - The session to resolve a name for
 * @returns The best available display name
 */
export function resolveDisplayName(session: SessionInfo): string {
  return session.customName || session.autoName || session.sessionId;
}

/**
 * Format an ISO timestamp as a compact relative time string.
 *
 * @param isoTimestamp - ISO 8601 timestamp string
 * @returns Compact relative time (e.g., `30s`, `5m`, `2h`, `3d`)
 */
export function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();

  if (diffMs < MS_PER_MINUTE) {
    const seconds = Math.max(1, Math.floor(diffMs / MS_PER_SECOND));
    return `${seconds}s`;
  }
  if (diffMs < MS_PER_HOUR) {
    return `${Math.floor(diffMs / MS_PER_MINUTE)}m`;
  }
  if (diffMs < MS_PER_DAY) {
    return `${Math.floor(diffMs / MS_PER_HOUR)}h`;
  }
  return `${Math.floor(diffMs / MS_PER_DAY)}d`;
}

/**
 * Build Quick Pick items from a sorted list of sessions, inserting separators
 * between status groups.
 *
 * @param sessions - Sorted sessions (call {@link sortSessionsByUrgency} first)
 * @returns Array of Quick Pick items including separators
 */
export function buildQuickPickItems(sessions: SessionInfo[]): SessionQuickPickItem[] {
  if (sessions.length === 0) {
    return [{ label: QUICK_PICK_STRINGS.NO_SESSIONS }];
  }

  const items: SessionQuickPickItem[] = [];
  let lastGroupLabel: string | undefined;

  for (const session of sessions) {
    const groupLabel = STATUS_GROUP_LABELS[session.status];

    // Insert a separator when entering a new status group
    if (groupLabel !== lastGroupLabel) {
      items.push({
        label: groupLabel,
        kind: vscode.QuickPickItemKind.Separator,
      });
      lastGroupLabel = groupLabel;
    }

    const icon = STATUS_ICONS[session.status];
    const name = resolveDisplayName(session);
    const ago = relativeTime(session.lastActivityAt);

    items.push({
      label: `${icon} ${name}`,
      description: ago,
      sessionId: session.sessionId,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Async command handler for `conductor.quickPickSession`.
 *
 * @remarks
 * Reads all sessions from SessionTracker, filters out sub-agents/hidden/artifacts,
 * sorts by urgency, shows a Quick Pick, and focuses the selected session in the
 * dashboard panel.
 *
 * @param context - VS Code extension context
 * @param sessionTracker - Session tracker to read current state from
 * @param nameStore - Persistence layer for custom session names
 * @param visibilityStore - Persistence layer for session visibility
 * @param createOrShowDeps - Dependencies forwarded to DashboardPanel.createOrShow
 */
export async function quickPickSession(
  context: vscode.ExtensionContext,
  sessionTracker: SessionTracker,
  nameStore: ISessionNameStore,
  visibilityStore: ISessionVisibilityStore,
  createOrShowDeps: CreateOrShowDeps
): Promise<void> {
  console.log(`${LOG_PREFIX.QUICK_PICK} Opening session quick pick`);

  const state = sessionTracker.getState(null);
  const hiddenIds = visibilityStore.getHiddenIds();
  const forceShownIds = visibilityStore.getForceShownIds();

  // Apply custom names from the name store
  const sessions = state.sessions
    .map((session) => {
      const customName = nameStore.getName(session.sessionId);
      if (customName) {
        return { ...session, customName };
      }
      return session;
    })
    .filter((session) => {
      // Exclude sub-agents
      if (session.isSubAgent) return false;
      // Exclude manually hidden sessions
      if (hiddenIds.has(session.sessionId)) return false;
      // Exclude artifacts unless force-shown
      if (session.isArtifact && !forceShownIds.has(session.sessionId)) return false;
      return true;
    });

  const sorted = sortSessionsByUrgency(sessions);
  const items = buildQuickPickItems(sorted);

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: QUICK_PICK_STRINGS.PLACEHOLDER,
    matchOnDescription: true,
  });

  if (!selected?.sessionId) {
    console.log(`${LOG_PREFIX.QUICK_PICK} No session selected`);
    return;
  }

  console.log(`${LOG_PREFIX.QUICK_PICK} Selected session: ${selected.sessionId}`);

  const panel = DashboardPanel.createOrShow(
    context,
    sessionTracker,
    nameStore,
    createOrShowDeps.orderStore,
    visibilityStore,
    createOrShowDeps.sessionLauncher,
    createOrShowDeps.ptyBridge,
    createOrShowDeps.launchedSessionStore,
    createOrShowDeps.sessionHistoryStore,
    createOrShowDeps.sessionHistoryService,
    createOrShowDeps.statsCacheReader,
    createOrShowDeps.tileLayoutStore
  );

  panel.focusSession(selected.sessionId);
}
