/**
 * Pure text extraction utilities for generating display-friendly session names.
 */

import { TRUNCATION } from '../constants';

/** Regex matching common plan title prefixes to strip. */
const PLAN_PREFIX_RE = /^(?:Plan:\s*|Implementation Plan:\s*|Plan to implement\s*)/i;

/**
 * Extract a concise display name from a user prompt.
 *
 * 1. Takes the first line only (up to newline)
 * 2. Extracts the first sentence (up to `.` `!` `?`)
 * 3. If still too long, truncates at last word boundary + `...`
 * 4. Caps at {@link TRUNCATION.SESSION_NAME_MAX} (100 chars)
 *
 * @param text - Raw user prompt text
 * @param maxLen - Maximum length (defaults to TRUNCATION.SESSION_NAME_MAX)
 * @returns Cleaned display name, or empty string for whitespace-only input
 */
export function extractSessionName(text: string, maxLen?: number): string {
  const limit = maxLen ?? TRUNCATION.SESSION_NAME_MAX;

  // First line only
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length === 0) return '';

  // Extract first sentence
  const sentenceMatch = firstLine.match(/^[^.!?]+[.!?]/);
  const candidate = sentenceMatch ? sentenceMatch[0].trim() : firstLine;

  if (candidate.length <= limit) return candidate;

  // Truncate at last word boundary
  const truncated = candidate.substring(0, limit);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > limit * 0.3) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}

/**
 * Extract a clean plan title from a markdown H1 heading line.
 *
 * Strips `# ` prefix and common plan prefixes like `Plan:`, `Implementation Plan:`.
 *
 * @param firstLine - The first line of a plan markdown file
 * @returns Cleaned title, or `undefined` if not a valid H1 or empty
 */
export function extractPlanTitle(firstLine: string): string | undefined {
  const trimmed = firstLine.trim();
  if (!trimmed.startsWith('# ')) return undefined;

  const heading = trimmed.substring(2).trim();
  if (heading.length === 0) return undefined;

  const cleaned = heading.replace(PLAN_PREFIX_RE, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
