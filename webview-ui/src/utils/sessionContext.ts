import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES } from '@shared/sharedConstants';
import { timeAgo } from './formatters';
import { UI_STRINGS } from '../config/strings';

/** Time window after which a launching session falls back to its real status. */
const LAUNCHING_TIMEOUT_MS = 30_000;

/**
 * Returns true when a session was launched by Conductor but hasn't received
 * any real activity yet (no turns, no tokens). Includes a 30-second timeout
 * so sessions don't show "Launching..." forever if the Claude process fails.
 */
export function isLaunchingSession(session: SessionInfo): boolean {
  if (
    session.launchedByConductor !== true ||
    session.turnCount !== 0 ||
    session.totalInputTokens !== 0 ||
    session.totalOutputTokens !== 0
  ) {
    return false;
  }
  const elapsed = Date.now() - new Date(session.startedAt).getTime();
  return elapsed < LAUNCHING_TIMEOUT_MS;
}

/**
 * Returns a short context string describing what the session is currently doing.
 * Used by OverviewCard and KanbanCard for the secondary text line.
 */
export function getContextText(session: SessionInfo): string {
  if (isLaunchingSession(session)) {
    return UI_STRINGS.CONTEXT_LAUNCHING;
  }
  switch (session.status) {
    case SESSION_STATUSES.WORKING:
      if (session.lastToolName) {
        return session.lastToolInput
          ? `${session.lastToolName} — ${session.lastToolInput}`
          : session.lastToolName;
      }
      return UI_STRINGS.CONTEXT_WORKING;
    case SESSION_STATUSES.THINKING:
      return UI_STRINGS.CONTEXT_THINKING;
    case SESSION_STATUSES.WAITING:
      if (session.pendingQuestion?.isToolApproval) {
        const tools = session.pendingQuestion.pendingTools;
        if (tools && tools.length > 0) {
          const desc = tools
            .map((t) => (t.inputSummary ? `${t.toolName} — ${t.inputSummary}` : t.toolName))
            .join(', ');
          const maxLen = 80; // inline-ok: matches TRUNCATION.TOOL_APPROVAL_DESC_MAX
          const truncated = desc.length > maxLen ? desc.substring(0, maxLen) + '...' : desc;
          return `${UI_STRINGS.CONTEXT_TOOL_APPROVAL}: ${truncated}`;
        }
        return UI_STRINGS.CONTEXT_TOOL_APPROVAL;
      }
      if (session.pendingQuestion?.isPlanApproval) {
        return session.pendingQuestion.planMode === 'enter'
          ? UI_STRINGS.CONTEXT_ENTER_PLAN_APPROVAL
          : UI_STRINGS.CONTEXT_EXIT_PLAN_APPROVAL;
      }
      return session.pendingQuestion
        ? session.pendingQuestion.question.length > 80
          ? session.pendingQuestion.question.substring(0, 80) + '...'
          : session.pendingQuestion.question
        : UI_STRINGS.CONTEXT_WAITING;
    case SESSION_STATUSES.ERROR:
      return UI_STRINGS.CONTEXT_ERROR;
    case SESSION_STATUSES.DONE:
      if (session.lastAssistantText) {
        return session.lastAssistantText;
      }
      return `${UI_STRINGS.CONTEXT_DONE} — ${timeAgo(session.lastActivityAt)}`;
    case SESSION_STATUSES.IDLE:
      return timeAgo(session.lastActivityAt);
    default:
      return '';
  }
}
