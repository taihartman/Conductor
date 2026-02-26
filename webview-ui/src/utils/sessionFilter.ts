import type { SessionInfo } from '@shared/types';

/** Returns true if the session matches the search query (case-insensitive). */
export function matchesSearchQuery(session: SessionInfo, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (session.customName?.toLowerCase().includes(q) ?? false) ||
    (session.autoName?.toLowerCase().includes(q) ?? false) ||
    session.slug.toLowerCase().includes(q) ||
    (session.model?.toLowerCase().includes(q) ?? false)
  );
}
