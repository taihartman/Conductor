import { describe, it, expect, beforeEach } from 'vitest';
import { ContinuationGrouper } from '../monitoring/ContinuationGrouper';
import { GroupableSession } from '../monitoring/IContinuationGrouper';
import { SessionInfo } from '../models/types';

function makeSession(
  id: string,
  overrides: {
    slug?: string;
    cwd?: string;
    startedAt?: string;
    lastActivityAt?: string;
    isSubAgent?: boolean;
    slugIsExplicit?: boolean;
    parentSessionId?: string;
  } = {}
): GroupableSession {
  const info: SessionInfo = {
    sessionId: id,
    slug: overrides.slug ?? id.substring(0, 8),
    summary: '',
    status: 'idle',
    model: '',
    gitBranch: '',
    cwd: overrides.cwd ?? '/project',
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00Z',
    lastActivityAt: overrides.lastActivityAt ?? '2026-01-01T00:10:00Z',
    turnCount: 5,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    isSubAgent: overrides.isSubAgent ?? false,
    filePath: `/home/.claude/projects/${id}.jsonl`,
  };
  return {
    info,
    slugIsExplicit: overrides.slugIsExplicit ?? true,
    parentSessionId: overrides.parentSessionId,
  };
}

describe('ContinuationGrouper', () => {
  let grouper: ContinuationGrouper;

  beforeEach(() => {
    grouper = new ContinuationGrouper();
  });

  it('groups two sessions with same slug and cwd; primary is earliest', () => {
    const sessions = new Map<string, GroupableSession>([
      [
        'session-b',
        makeSession('session-b', {
          slug: 'my-slug',
          cwd: '/project',
          startedAt: '2026-01-01T01:00:00Z',
        }),
      ],
      [
        'session-a',
        makeSession('session-a', {
          slug: 'my-slug',
          cwd: '/project',
          startedAt: '2026-01-01T00:00:00Z',
        }),
      ],
    ]);

    grouper.ensureFresh(sessions);

    // session-a is earlier → primary
    expect(grouper.getPrimaryId('session-a')).toBe('session-a');
    expect(grouper.getPrimaryId('session-b')).toBe('session-a');
    expect(grouper.getGroupMembers('session-a')).toEqual(['session-a', 'session-b']);
    expect(grouper.isGrouped('session-a')).toBe(true);
    expect(grouper.isGrouped('session-b')).toBe(true);
  });

  it('produces identity mapping for single-session slugs', () => {
    const sessions = new Map<string, GroupableSession>([
      ['session-1', makeSession('session-1', { slug: 'slug-one', cwd: '/project' })],
      ['session-2', makeSession('session-2', { slug: 'slug-two', cwd: '/project' })],
    ]);

    grouper.ensureFresh(sessions);

    expect(grouper.getPrimaryId('session-1')).toBe('session-1');
    expect(grouper.getPrimaryId('session-2')).toBe('session-2');
    expect(grouper.getGroupMembers('session-1')).toEqual(['session-1']);
    expect(grouper.isGrouped('session-1')).toBe(false);
    expect(grouper.isGrouped('session-2')).toBe(false);
  });

  it('does NOT merge sessions with same slug but different cwd', () => {
    const sessions = new Map<string, GroupableSession>([
      ['s1', makeSession('s1', { slug: 'shared-slug', cwd: '/project-a' })],
      ['s2', makeSession('s2', { slug: 'shared-slug', cwd: '/project-b' })],
    ]);

    grouper.ensureFresh(sessions);

    expect(grouper.getPrimaryId('s1')).toBe('s1');
    expect(grouper.getPrimaryId('s2')).toBe('s2');
    expect(grouper.isGrouped('s1')).toBe(false);
    expect(grouper.isGrouped('s2')).toBe(false);
  });

  it('does NOT merge sessions without explicit slug', () => {
    const sessions = new Map<string, GroupableSession>([
      ['s1', makeSession('s1', { slug: 'my-slug', cwd: '/project', slugIsExplicit: true })],
      ['s2', makeSession('s2', { slug: 'my-slug', cwd: '/project', slugIsExplicit: false })],
    ]);

    grouper.ensureFresh(sessions);

    // s2 is excluded from grouping because slugIsExplicit is false
    expect(grouper.getPrimaryId('s1')).toBe('s1');
    expect(grouper.isGrouped('s1')).toBe(false);
    // s2 should still identity-map to itself
    expect(grouper.getPrimaryId('s2')).toBe('s2');
  });

  it('markDirty() + ensureFresh() rebuilds correctly', () => {
    const sessions = new Map<string, GroupableSession>([
      ['s1', makeSession('s1', { slug: 'slug-a', cwd: '/project' })],
    ]);

    grouper.ensureFresh(sessions);
    expect(grouper.isGrouped('s1')).toBe(false);

    // Add a second session with the same slug
    sessions.set(
      's2',
      makeSession('s2', {
        slug: 'slug-a',
        cwd: '/project',
        startedAt: '2026-01-01T01:00:00Z',
      })
    );
    grouper.markDirty();
    grouper.ensureFresh(sessions);

    expect(grouper.isGrouped('s1')).toBe(true);
    expect(grouper.getPrimaryId('s2')).toBe('s1');
    expect(grouper.getGroupMembers('s1')).toEqual(['s1', 's2']);
  });

  it('getMostRecentMember() returns member with latest lastActivityAt', () => {
    const sessions = new Map<string, GroupableSession>([
      [
        's1',
        makeSession('s1', {
          slug: 'slug',
          cwd: '/p',
          startedAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:05:00Z',
        }),
      ],
      [
        's2',
        makeSession('s2', {
          slug: 'slug',
          cwd: '/p',
          startedAt: '2026-01-01T01:00:00Z',
          lastActivityAt: '2026-01-01T01:30:00Z',
        }),
      ],
      [
        's3',
        makeSession('s3', {
          slug: 'slug',
          cwd: '/p',
          startedAt: '2026-01-01T02:00:00Z',
          lastActivityAt: '2026-01-01T02:00:00Z',
        }),
      ],
    ]);

    grouper.ensureFresh(sessions);

    // s2 has the latest lastActivityAt
    expect(grouper.getMostRecentMember('s1', sessions)).toBe('s3');

    // Update s3 to be the most recent
    sessions.get('s3')!.info.lastActivityAt = '2026-01-01T03:00:00Z';
    expect(grouper.getMostRecentMember('s1', sessions)).toBe('s3');
  });

  it('skips sub-agent sessions from continuation grouping', () => {
    const sessions = new Map<string, GroupableSession>([
      ['parent', makeSession('parent', { slug: 'slug', cwd: '/p' })],
      [
        'agent',
        makeSession('agent', {
          slug: 'slug',
          cwd: '/p',
          isSubAgent: true,
          parentSessionId: 'parent',
        }),
      ],
    ]);

    grouper.ensureFresh(sessions);

    // Sub-agent should not be grouped with parent despite same slug+cwd
    expect(grouper.isGrouped('parent')).toBe(false);
    expect(grouper.getGroupMembers('parent')).toEqual(['parent']);
  });

  it('returns identity for unknown session IDs', () => {
    grouper.ensureFresh(new Map());

    expect(grouper.getPrimaryId('unknown')).toBe('unknown');
    expect(grouper.getGroupMembers('unknown')).toEqual(['unknown']);
    expect(grouper.isGrouped('unknown')).toBe(false);
  });
});
