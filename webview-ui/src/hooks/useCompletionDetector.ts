import { useState, useEffect, useRef } from 'react';
import type { SessionInfo } from '@shared/types';
import { STATUS_GROUPS } from '@shared/sharedConstants';

/**
 * Pure function: counts how many sessions transitioned from active to completed.
 * Exported for testability.
 */
export function countCompletions(
  prevSessions: SessionInfo[],
  currentSessions: SessionInfo[]
): number {
  if (prevSessions.length === 0) return 0;

  let count = 0;
  for (const session of currentSessions) {
    const prevSession = prevSessions.find((s) => s.sessionId === session.sessionId);
    if (
      prevSession &&
      STATUS_GROUPS.ACTIVE.has(prevSession.status) &&
      STATUS_GROUPS.COMPLETED.has(session.status)
    ) {
      count++;
    }
  }
  return count;
}

export function useCompletionDetector(sessions: SessionInfo[]): number {
  const prevSessionsRef = useRef<SessionInfo[]>([]);
  const [completionCount, setCompletionCount] = useState(0);

  useEffect(() => {
    const prev = prevSessionsRef.current;
    prevSessionsRef.current = sessions;

    const newCompletions = countCompletions(prev, sessions);
    if (newCompletions > 0) {
      setCompletionCount((c) => c + newCompletions);
    }
  }, [sessions]);

  return completionCount;
}
