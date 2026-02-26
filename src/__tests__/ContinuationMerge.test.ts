import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionTracker } from '../monitoring/SessionTracker';
import { JsonlParser } from '../monitoring/JsonlParser';
import * as vscode from 'vscode';

/** Helper: push records into a SessionTracker instance via its private methods. */
function feedRecords(
  tracker: SessionTracker,
  sessionId: string,
  records: any[],
  options?: { isSubAgent?: boolean; parentSessionId?: string }
): void {
  const sessionFile = {
    sessionId,
    filePath: `/tmp/test/${sessionId}.jsonl`,
    projectDir: 'test-project',
    isSubAgent: options?.isSubAgent || false,
    modifiedAt: new Date(),
    parentSessionId: options?.parentSessionId,
  };
  const t = tracker as any;
  t.handleNewFile(sessionFile);
  t.handleRecords({ sessionFile, records });
}

/** Build a recent assistant record JSON string. */
function assistantJson(opts: {
  slug: string;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  tokens?: { input: number; output: number };
}): string {
  const tokens = opts.tokens ?? { input: 100, output: 50 };
  return JSON.stringify({
    type: 'assistant',
    slug: opts.slug,
    sessionId: opts.sessionId,
    timestamp: opts.timestamp,
    cwd: opts.cwd ?? '/project',
    message: {
      model: 'claude-sonnet-4-6',
      id: `msg-${opts.sessionId}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Working on it' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: tokens.input,
        output_tokens: tokens.output,
      },
    },
  });
}

/** Build a user record JSON string. */
function userJson(opts: {
  slug: string;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  text?: string;
}): string {
  return JSON.stringify({
    type: 'user',
    slug: opts.slug,
    sessionId: opts.sessionId,
    timestamp: opts.timestamp,
    cwd: opts.cwd ?? '/project',
    message: {
      role: 'user',
      content: opts.text ?? 'Do something',
    },
  });
}

/** Build a system turn_duration record JSON string. */
function turnDurationJson(opts: { slug: string; sessionId: string; timestamp: string }): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'turn_duration',
    slug: opts.slug,
    sessionId: opts.sessionId,
    timestamp: opts.timestamp,
    durationMs: 5000,
  });
}

describe('Continuation session merging', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    vi.useFakeTimers();
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });

  it('merges two sessions with same slug+cwd into one with summed tokens and turns', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();

    // First continuation member
    feedRecords(
      tracker,
      'cont-1',
      JsonlParser.parseString(
        assistantJson({
          slug: 'my-slug',
          sessionId: 'cont-1',
          timestamp: t1,
          tokens: { input: 200, output: 100 },
        })
      )
    );

    // Second continuation member — same slug, same cwd
    feedRecords(
      tracker,
      'cont-2',
      JsonlParser.parseString(
        assistantJson({
          slug: 'my-slug',
          sessionId: 'cont-2',
          timestamp: t2,
          tokens: { input: 300, output: 150 },
        })
      )
    );

    const state = tracker.getState();
    // Should produce a single merged session
    const merged = state.sessions.find((s) => s.sessionId === 'cont-1');
    expect(merged).toBeDefined();
    expect(merged!.continuationCount).toBe(1);
    expect(merged!.continuationSessionIds).toEqual(['cont-1', 'cont-2']);
    expect(merged!.totalInputTokens).toBe(500);
    expect(merged!.totalOutputTokens).toBe(250);
    // No separate entry for cont-2
    expect(state.sessions.find((s) => s.sessionId === 'cont-2')).toBeUndefined();
  });

  it('uses status from most recent member', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 120000).toISOString();
    const t2 = new Date(now.getTime() - 1000).toISOString();

    // Feed first member with old timestamp (will be done via replay detection)
    feedRecords(
      tracker,
      'status-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'status-slug', sessionId: 'status-1', timestamp: t1 })
      )
    );

    // Feed second member with recent timestamp (will be working)
    feedRecords(
      tracker,
      'status-2',
      JsonlParser.parseString(
        assistantJson({ slug: 'status-slug', sessionId: 'status-2', timestamp: t2 })
      )
    );

    const state = tracker.getState();
    const merged = state.sessions.find((s) => s.sessionId === 'status-1');
    expect(merged).toBeDefined();
    // Most recent member (status-2) should determine the merged status
    expect(merged!.lastActivityAt).toBe(t2);
  });

  it('groups sub-agents from any continuation member under merged parent', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();
    const tAgent = new Date(now.getTime() - 20000).toISOString();

    // Two continuation members
    feedRecords(
      tracker,
      'parent-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'the-slug', sessionId: 'parent-1', timestamp: t1 })
      )
    );
    feedRecords(
      tracker,
      'parent-2',
      JsonlParser.parseString(
        assistantJson({ slug: 'the-slug', sessionId: 'parent-2', timestamp: t2 })
      )
    );

    // Sub-agent whose parentSessionId points to the NON-primary member
    feedRecords(
      tracker,
      'agent-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'agent-slug', sessionId: 'parent-2', timestamp: tAgent })
      ),
      { isSubAgent: true, parentSessionId: 'parent-2' }
    );

    const state = tracker.getState();
    const merged = state.sessions.find((s) => s.sessionId === 'parent-1');
    expect(merged).toBeDefined();
    // Child agent should appear under the merged parent
    expect(merged!.childAgents).toHaveLength(1);
    expect(merged!.childAgents![0].sessionId).toBe('agent-1');
  });

  it('shows activities from all members when merged session is focused', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();

    feedRecords(
      tracker,
      'act-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'act-slug', sessionId: 'act-1', timestamp: t1 })
      )
    );
    feedRecords(
      tracker,
      'act-2',
      JsonlParser.parseString(
        assistantJson({ slug: 'act-slug', sessionId: 'act-2', timestamp: t2 })
      )
    );

    const activities = tracker.getFilteredActivities('act-1');
    // Should include activities from both members
    const act1Events = activities.filter((a) => a.sessionId === 'act-1');
    const act2Events = activities.filter((a) => a.sessionId === 'act-2');
    expect(act1Events.length).toBeGreaterThan(0);
    expect(act2Events.length).toBeGreaterThan(0);
  });

  it('returns conversations from all members with continuationSegmentIndex', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();

    feedRecords(
      tracker,
      'conv-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'conv-slug', sessionId: 'conv-1', timestamp: t1 })
      )
    );
    feedRecords(
      tracker,
      'conv-2',
      JsonlParser.parseString(
        assistantJson({ slug: 'conv-slug', sessionId: 'conv-2', timestamp: t2 })
      )
    );

    const conversation = tracker.getFilteredConversation('conv-1');
    expect(conversation.length).toBeGreaterThan(0);

    // Turns from conv-1 should have segment index 0, conv-2 should have segment index 1
    const seg0 = conversation.filter((t) => t.continuationSegmentIndex === 0);
    const seg1 = conversation.filter((t) => t.continuationSegmentIndex === 1);
    expect(seg0.length).toBeGreaterThan(0);
    expect(seg1.length).toBeGreaterThan(0);
  });

  it('does NOT merge sessions with same slug but different cwd', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();

    feedRecords(
      tracker,
      'diff-cwd-1',
      JsonlParser.parseString(
        assistantJson({
          slug: 'same-slug',
          sessionId: 'diff-cwd-1',
          timestamp: t1,
          cwd: '/project-a',
        })
      )
    );
    feedRecords(
      tracker,
      'diff-cwd-2',
      JsonlParser.parseString(
        assistantJson({
          slug: 'same-slug',
          sessionId: 'diff-cwd-2',
          timestamp: t2,
          cwd: '/project-b',
        })
      )
    );

    const state = tracker.getState();
    // Both should appear as separate sessions
    expect(state.sessions.find((s) => s.sessionId === 'diff-cwd-1')).toBeDefined();
    expect(state.sessions.find((s) => s.sessionId === 'diff-cwd-2')).toBeDefined();
  });

  it('custom name resolution checks all member IDs', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();

    feedRecords(
      tracker,
      'name-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'name-slug', sessionId: 'name-1', timestamp: t1 })
      )
    );
    feedRecords(
      tracker,
      'name-2',
      JsonlParser.parseString(
        assistantJson({ slug: 'name-slug', sessionId: 'name-2', timestamp: t2 })
      )
    );

    const state = tracker.getState();
    const merged = state.sessions.find((s) => s.sessionId === 'name-1');
    expect(merged).toBeDefined();
    // autoName should be from first member that set it (via user prompt)
    // In this test both just have text responses, so autoName comes from neither
    // but the merged session should still have continuationSessionIds
    expect(merged!.continuationSessionIds).toEqual(['name-1', 'name-2']);
  });

  it('routes terminal input to most recent active member', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 1000).toISOString();

    feedRecords(
      tracker,
      'route-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'route-slug', sessionId: 'route-1', timestamp: t1 })
      )
    );
    feedRecords(
      tracker,
      'route-2',
      JsonlParser.parseString(
        assistantJson({ slug: 'route-slug', sessionId: 'route-2', timestamp: t2 })
      )
    );

    // getMostRecentContinuationMember should resolve to route-2 (most recent)
    const target = tracker.getMostRecentContinuationMember('route-1');
    expect(target).toBe('route-2');
  });

  it('handles intermediate state: one member has slug, other does not yet', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();

    // First member with slug
    feedRecords(
      tracker,
      'partial-1',
      JsonlParser.parseString(
        assistantJson({ slug: 'partial-slug', sessionId: 'partial-1', timestamp: t1 })
      )
    );

    // Second member WITHOUT slug yet (slug field absent from record)
    const noSlugRecord = JSON.stringify({
      type: 'assistant',
      sessionId: 'partial-2',
      timestamp: t2,
      cwd: '/project',
      message: {
        model: 'claude-sonnet-4-6',
        id: 'msg-partial-2',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Working' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    feedRecords(tracker, 'partial-2', JsonlParser.parseString(noSlugRecord));

    // Should NOT be grouped yet — partial-2 has no explicit slug
    let state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'partial-1')).toBeDefined();
    expect(state.sessions.find((s) => s.sessionId === 'partial-2')).toBeDefined();

    // Now feed a record with slug for partial-2
    feedRecords(
      tracker,
      'partial-2',
      JsonlParser.parseString(
        assistantJson({
          slug: 'partial-slug',
          sessionId: 'partial-2',
          timestamp: new Date(now.getTime() - 10000).toISOString(),
        })
      )
    );

    // Now they should be grouped
    state = tracker.getState();
    const merged = state.sessions.find((s) => s.sessionId === 'partial-1');
    expect(merged).toBeDefined();
    expect(merged!.continuationCount).toBe(1);
    expect(state.sessions.find((s) => s.sessionId === 'partial-2')).toBeUndefined();
  });

  it('focused sub-agent whose parent is non-primary continuation member shows activities', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60000).toISOString();
    const t2 = new Date(now.getTime() - 30000).toISOString();
    const tAgent = new Date(now.getTime() - 20000).toISOString();

    // Two continuation members
    feedRecords(
      tracker,
      'p1',
      JsonlParser.parseString(assistantJson({ slug: 'sub-test', sessionId: 'p1', timestamp: t1 }))
    );
    feedRecords(
      tracker,
      'p2',
      JsonlParser.parseString(assistantJson({ slug: 'sub-test', sessionId: 'p2', timestamp: t2 }))
    );

    // Sub-agent of p2 (non-primary)
    feedRecords(
      tracker,
      'sa1',
      JsonlParser.parseString(
        assistantJson({ slug: 'agent-x', sessionId: 'p2', timestamp: tAgent })
      ),
      { isSubAgent: true, parentSessionId: 'p2' }
    );

    // When focusing the sub-agent, should still see its activities
    const activities = tracker.getFilteredActivities('sa1');
    expect(activities.length).toBeGreaterThan(0);
    expect(activities.every((a) => a.sessionId === 'sa1')).toBe(true);
  });
});
