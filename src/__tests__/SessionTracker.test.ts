import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonlParser } from '../monitoring/JsonlParser';
import { SessionTracker } from '../monitoring/SessionTracker';
import { AssistantRecord, UserRecord, SystemRecord, SummaryRecord } from '../models/types';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shared test helper: push records into a SessionTracker instance via its private methods.
 * Hoisted to avoid duplication across describe blocks.
 */
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

describe('SessionTracker record processing', () => {
  it('parses assistant records with tool_use', () => {
    const line =
      '{"type":"assistant","slug":"test-slug","sessionId":"s1","timestamp":"2026-02-25T10:00:00Z","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Looking at the code"},{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":500}}}';
    const records = JsonlParser.parseString(line);

    expect(records).toHaveLength(1);
    const record = records[0] as AssistantRecord;
    expect(record.type).toBe('assistant');
    expect(record.message.model).toBe('claude-sonnet-4-6');
    expect(record.message.content).toHaveLength(2);
    expect(record.message.content[0].type).toBe('text');
    expect(record.message.content[1].type).toBe('tool_use');
    expect(record.message.usage.input_tokens).toBe(100);
  });

  it('parses user records with tool_result', () => {
    const line =
      '{"type":"user","slug":"test-slug","sessionId":"s1","timestamp":"2026-02-25T10:00:01Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"file contents"}]}}';
    const records = JsonlParser.parseString(line);

    expect(records).toHaveLength(1);
    const record = records[0] as UserRecord;
    expect(record.type).toBe('user');
    expect(record.message.content[0].type).toBe('tool_result');
  });

  it('parses system turn_duration records', () => {
    const line =
      '{"type":"system","subtype":"turn_duration","durationMs":15000,"timestamp":"2026-02-25T10:00:15Z"}';
    const records = JsonlParser.parseString(line);

    expect(records).toHaveLength(1);
    const record = records[0] as SystemRecord;
    expect(record.subtype).toBe('turn_duration');
    expect(record.durationMs).toBe(15000);
  });

  it('parses summary records', () => {
    const line =
      '{"type":"summary","summary":"Fixed login bug by correcting comparison operator","timestamp":"2026-02-25T10:00:16Z"}';
    const records = JsonlParser.parseString(line);

    expect(records).toHaveLength(1);
    const record = records[0] as SummaryRecord;
    expect(record.summary).toBe('Fixed login bug by correcting comparison operator');
  });

  it('processes complete session from fixture', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample-session.jsonl');
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const records = JsonlParser.parseString(content);

    // Track state transitions
    const statusTransitions: string[] = [];
    let turnCount = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const record of records) {
      switch (record.type) {
        case 'assistant': {
          const msg = (record as AssistantRecord).message;
          totalInput += msg.usage?.input_tokens || 0;
          totalOutput += msg.usage?.output_tokens || 0;
          const hasToolUse = msg.content.some((c) => c.type === 'tool_use');
          if (hasToolUse) {
            statusTransitions.push('working');
          }
          if (msg.stop_reason === 'end_turn' && !hasToolUse) {
            turnCount++;
          }
          break;
        }
        case 'user': {
          const userMsg = (record as UserRecord).message;
          const hasToolResult = userMsg.content.some((c) => c.type === 'tool_result');
          if (hasToolResult) {
            statusTransitions.push('working');
          }
          break;
        }
        case 'system': {
          const sys = record as SystemRecord;
          if (sys.subtype === 'turn_duration') {
            statusTransitions.push('waiting');
            turnCount++;
          }
          break;
        }
      }
    }

    // Verify state machine transitions make sense
    expect(statusTransitions.length).toBeGreaterThan(0);
    expect(statusTransitions[statusTransitions.length - 1]).toBe('waiting');
    expect(totalInput).toBeGreaterThan(0);
    expect(totalOutput).toBeGreaterThan(0);
    expect(turnCount).toBeGreaterThanOrEqual(1);
  });

  it('detects AskUserQuestion as waiting status', () => {
    const line =
      '{"type":"assistant","slug":"test","sessionId":"s1","timestamp":"2026-02-25T10:00:00Z","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"AskUserQuestion","input":{"question":"Which approach?"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}';
    const records = JsonlParser.parseString(line);
    const record = records[0] as AssistantRecord;

    const hasAskUser = record.message.content.some(
      (c) => c.type === 'tool_use' && 'name' in c && c.name === 'AskUserQuestion'
    );
    expect(hasAskUser).toBe(true);
  });
});

describe('SessionTracker replay detection', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('marks replayed session with old timestamps as idle', () => {
    const oldTimestamp = '2026-01-01T10:00:00Z'; // > 5 minutes ago
    const records = JsonlParser.parseString(
      `{"type":"assistant","slug":"old-session","sessionId":"old1","timestamp":"${oldTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
    );

    feedRecords(tracker, 'old1', records);

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'old1');
    expect(session).toBeDefined();
    expect(session!.status).toBe('done');
  });

  it('preserves active status for session with recent timestamps', () => {
    const recentTimestamp = new Date().toISOString(); // right now
    // Use stop_reason: null to simulate streaming/mid-generation (working state).
    // stop_reason: "tool_use" now correctly produces "waiting" (tool approval).
    const records = JsonlParser.parseString(
      `{"type":"assistant","slug":"live-session","sessionId":"live1","timestamp":"${recentTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
    );

    feedRecords(tracker, 'live1', records);

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'live1');
    expect(session).toBeDefined();
    expect(session!.status).toBe('working');
  });

  it('does not override status on subsequent reads after initial replay', () => {
    const oldTimestamp = '2026-01-01T10:00:00Z';
    const records1 = JsonlParser.parseString(
      `{"type":"assistant","slug":"multi-read","sessionId":"mr1","timestamp":"${oldTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
    );

    const sessionFile = {
      sessionId: 'mr1',
      filePath: '/tmp/test/mr1.jsonl',
      projectDir: 'test-project',
      isSubAgent: false,
      modifiedAt: new Date(),
    };
    const t = tracker as any;
    t.handleNewFile(sessionFile);

    // First read: marks as done (old timestamp, replay detection)
    t.handleRecords({ sessionFile, records: records1 });
    let state = tracker.getState();
    let session = state.sessions.find((s) => s.sessionId === 'mr1');
    expect(session!.status).toBe('done');

    // Second read: new live records should NOT be forced done
    const liveTimestamp = new Date().toISOString();
    const records2 = JsonlParser.parseString(
      `{"type":"user","slug":"multi-read","sessionId":"mr1","timestamp":"${liveTimestamp}","message":{"role":"user","content":[{"type":"text","text":"Do something"}]}}`
    );
    t.handleRecords({ sessionFile, records: records2 });
    state = tracker.getState();
    session = state.sessions.find((s) => s.sessionId === 'mr1');
    // User text input sets status to 'working'
    expect(session!.status).toBe('working');
  });
});

describe('SessionTracker parent-child grouping', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('links sub-agent to parent via directory-based parentSessionId', () => {
    const now = new Date().toISOString();

    // Create parent session
    feedRecords(
      tracker,
      'parent-1',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"parent","sessionId":"parent-1","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Hello"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    // Create sub-agent linked via directory structure
    feedRecords(
      tracker,
      'agent-abc',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"explore-agent","sessionId":"parent-1","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg2","type":"message","role":"assistant","content":[{"type":"text","text":"Exploring"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      ),
      { isSubAgent: true, parentSessionId: 'parent-1' }
    );

    const state = tracker.getState();

    // Parent session should have child agents
    const parent = state.sessions.find((s) => s.sessionId === 'parent-1');
    expect(parent).toBeDefined();
    expect(parent!.childAgents).toBeDefined();
    expect(parent!.childAgents).toHaveLength(1);
    expect(parent!.childAgents![0].sessionId).toBe('agent-abc');
  });

  it('links sub-agent to parent via JSONL sessionId field', () => {
    const now = new Date().toISOString();

    // Create parent session
    feedRecords(
      tracker,
      'parent-2',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"parent","sessionId":"parent-2","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Hello"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    // Create root-level sub-agent (no parentSessionId from directory) — the JSONL record has sessionId=parent-2
    feedRecords(
      tracker,
      'agent-root',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"root-agent","sessionId":"parent-2","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg2","type":"message","role":"assistant","content":[{"type":"text","text":"Working"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      ),
      { isSubAgent: true }
    );

    const state = tracker.getState();
    const parent = state.sessions.find((s) => s.sessionId === 'parent-2');
    expect(parent).toBeDefined();
    expect(parent!.childAgents).toHaveLength(1);
    expect(parent!.childAgents![0].sessionId).toBe('agent-root');
  });

  it('orphaned sub-agents appear at top level', () => {
    const now = new Date().toISOString();

    // Create sub-agent with no matching parent
    feedRecords(
      tracker,
      'agent-orphan',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"orphan-agent","sessionId":"nonexistent-parent","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Lost"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      ),
      { isSubAgent: true }
    );

    const state = tracker.getState();

    // Orphan should appear at top level
    const orphan = state.sessions.find((s) => s.sessionId === 'agent-orphan');
    expect(orphan).toBeDefined();
    expect(orphan!.isSubAgent).toBe(true);
    // Should not have childAgents (it's an orphaned sub-agent, not a parent)
    expect(orphan!.childAgents).toBeUndefined();
  });

  it('focusing a parent session includes child agent activities', () => {
    const now = new Date().toISOString();

    // Create parent session with activity
    feedRecords(
      tracker,
      'parent-3',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"parent","sessionId":"parent-3","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/a.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    // Create child agent with activity
    feedRecords(
      tracker,
      'agent-child',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"child","sessionId":"parent-3","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg2","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu2","name":"Grep","input":{"pattern":"foo"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      ),
      { isSubAgent: true, parentSessionId: 'parent-3' }
    );

    // Focus on parent — pass focusedSessionId to getState
    const state = tracker.getState('parent-3');

    // Activities should include both parent and child
    const activitySessionIds = state.activities.map((a) => a.sessionId);
    expect(activitySessionIds).toContain('parent-3');
    expect(activitySessionIds).toContain('agent-child');
  });

  it('getState(null) returns unfiltered activities from all sessions', () => {
    const now = new Date().toISOString();

    // Create two sessions with activities
    feedRecords(
      tracker,
      'session-a',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"sess-a","sessionId":"session-a","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/a.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    feedRecords(
      tracker,
      'session-b',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"sess-b","sessionId":"session-b","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg2","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu2","name":"Grep","input":{"pattern":"foo"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      )
    );

    // Focus on session-a — only session-a activities
    let state = tracker.getState('session-a');
    expect(state.activities.every((a) => a.sessionId === 'session-a')).toBe(true);

    // No focus — both sessions' activities should appear
    state = tracker.getState(null);
    const sessionIds = new Set(state.activities.map((a) => a.sessionId));
    expect(sessionIds.has('session-a')).toBe(true);
    expect(sessionIds.has('session-b')).toBe(true);
  });

  it('focusing a sub-agent shows only that agent activities', () => {
    const now = new Date().toISOString();

    // Create parent
    feedRecords(
      tracker,
      'parent-4',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"parent","sessionId":"parent-4","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/a.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    // Create child
    feedRecords(
      tracker,
      'agent-child2',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"child","sessionId":"parent-4","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg2","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu2","name":"Grep","input":{"pattern":"foo"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      ),
      { isSubAgent: true, parentSessionId: 'parent-4' }
    );

    // Focus on sub-agent — pass focusedSessionId to getState
    const state = tracker.getState('agent-child2');

    // Activities should only be from the sub-agent
    const activitySessionIds = state.activities.map((a) => a.sessionId);
    expect(activitySessionIds.every((id) => id === 'agent-child2')).toBe(true);
  });

  it('cleanup removes stale sessions and their children', () => {
    const oldTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5 hours ago

    // Create parent session (will be idle from replay detection)
    feedRecords(
      tracker,
      'stale-parent',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"stale","sessionId":"stale-parent","timestamp":"${oldTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Old"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    // Create child of stale parent
    feedRecords(
      tracker,
      'agent-stale-child',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"stale-child","sessionId":"stale-parent","timestamp":"${oldTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg2","type":"message","role":"assistant","content":[{"type":"text","text":"Old child"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":25}}}`
      ),
      { isSubAgent: true, parentSessionId: 'stale-parent' }
    );

    // Verify both exist before cleanup
    let state = tracker.getState();
    expect(state.sessions.some((s) => s.sessionId === 'stale-parent')).toBe(true);

    // Trigger cleanup via private method
    const t = tracker as any;
    t.cleanupStaleSessions();

    // Both parent and child should be removed
    state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'stale-parent')).toBeUndefined();
    expect(state.sessions.find((s) => s.sessionId === 'agent-stale-child')).toBeUndefined();
  });
});

describe('SessionTracker inactivity timeout', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  /** Helper: directly set a session's lastActivityAt to simulate staleness. */
  function setLastActivity(sessionId: string, timestamp: string): void {
    const t = tracker as any;
    const session = t.sessions.get(sessionId);
    if (session) {
      session.info.lastActivityAt = timestamp;
    }
  }

  function makeToolUseRecord(sessionId: string, timestamp: string): string {
    // Use stop_reason: null (streaming) to produce "working" status.
    // stop_reason: "tool_use" now correctly produces "waiting" (tool approval).
    return `{"type":"assistant","slug":"${sessionId}","sessionId":"${sessionId}","timestamp":"${timestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`;
  }

  function makeWaitingRecord(sessionId: string, timestamp: string): string {
    return `{"type":"assistant","slug":"${sessionId}","sessionId":"${sessionId}","timestamp":"${timestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"AskUserQuestion","input":{"question":"Which approach?"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`;
  }

  function makeThinkingRecord(sessionId: string, timestamp: string): string {
    // Progress record puts the state machine into 'thinking'
    return `{"type":"progress","sessionId":"${sessionId}","timestamp":"${timestamp}"}`;
  }

  it('transitions working session to done after inactivity timeout', () => {
    const now = new Date().toISOString();
    feedRecords(tracker, 'work-1', JsonlParser.parseString(makeToolUseRecord('work-1', now)));

    // Verify it's working
    let state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'work-1')!.status).toBe('working');

    // Simulate 11 minutes of inactivity
    setLastActivity('work-1', new Date(Date.now() - 11 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();

    state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'work-1')!.status).toBe('done');
  });

  it('transitions thinking session to done after inactivity timeout', () => {
    const now = new Date().toISOString();
    // First make working, then feed a progress record to get thinking
    feedRecords(tracker, 'think-1', JsonlParser.parseString(makeThinkingRecord('think-1', now)));

    let state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'think-1')!.status).toBe('thinking');

    setLastActivity('think-1', new Date(Date.now() - 11 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();

    state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'think-1')!.status).toBe('done');
  });

  it('transitions waiting session to done after inactivity timeout', () => {
    const now = new Date().toISOString();
    feedRecords(tracker, 'wait-1', JsonlParser.parseString(makeWaitingRecord('wait-1', now)));

    let state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'wait-1')!.status).toBe('waiting');

    setLastActivity('wait-1', new Date(Date.now() - 11 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();

    state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'wait-1')!.status).toBe('done');
  });

  it('does NOT transition working session that is still recent', () => {
    const now = new Date().toISOString();
    feedRecords(tracker, 'work-2', JsonlParser.parseString(makeToolUseRecord('work-2', now)));

    // Only 5 minutes of inactivity — below the 10-min threshold
    setLastActivity('work-2', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();

    const state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'work-2')!.status).toBe('working');
  });

  it('removes session done by inactivity after stale threshold', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'stale-done-1',
      JsonlParser.parseString(makeToolUseRecord('stale-done-1', now))
    );

    // First: inactivity timeout (11 min) → done
    setLastActivity('stale-done-1', new Date(Date.now() - 11 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();
    let state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'stale-done-1')!.status).toBe('done');

    // Second: stale removal (31 min) → removed from memory
    setLastActivity('stale-done-1', new Date(Date.now() - 31 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();
    state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'stale-done-1')).toBeUndefined();
  });

  it('emits state change when Pass 1 transitions but Pass 2 removes nothing', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = new Date().toISOString();
      feedRecords(tracker, 'emit-1', JsonlParser.parseString(makeToolUseRecord('emit-1', now)));

      const stateChangedSpy = vi.fn();
      tracker.onStateChanged(stateChangedSpy);

      // 11 min inactivity → Pass 1 transitions to done, Pass 2 has nothing to remove
      setLastActivity('emit-1', new Date(Date.now() - 11 * 60 * 1000).toISOString());
      (tracker as any).cleanupStaleSessions();

      // emitStateChanged is debounced — flush it
      vi.runAllTimers();

      expect(stateChangedSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('self-heals: session marked done by inactivity revives on new record', () => {
    const now = new Date().toISOString();
    feedRecords(tracker, 'heal-1', JsonlParser.parseString(makeToolUseRecord('heal-1', now)));

    // Inactivity timeout → done
    setLastActivity('heal-1', new Date(Date.now() - 11 * 60 * 1000).toISOString());
    (tracker as any).cleanupStaleSessions();
    let state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'heal-1')!.status).toBe('done');

    // New record arrives → state machine transitions back to working
    const liveTimestamp = new Date().toISOString();
    const sessionFile = {
      sessionId: 'heal-1',
      filePath: '/tmp/test/heal-1.jsonl',
      projectDir: 'test-project',
      isSubAgent: false,
      modifiedAt: new Date(),
    };
    (tracker as any).handleRecords({
      sessionFile,
      records: JsonlParser.parseString(makeToolUseRecord('heal-1', liveTimestamp)),
    });

    state = tracker.getState();
    expect(state.sessions.find((s) => s.sessionId === 'heal-1')!.status).toBe('working');
  });
});

describe('SessionTracker.updateScope', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    // Default: no additional workspaces
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
    mockGetConfiguration.mockReset();
  });

  it('updateScope is a no-op when dirs have not changed', () => {
    // Start the tracker so there's a watcher to potentially dispose
    tracker.start();

    const t = tracker as any;
    const oldWatcher = t.watcher;
    const disposeSpy = vi.spyOn(oldWatcher, 'dispose');

    // Call updateScope with same (empty) config — should skip restart
    tracker.updateScope(undefined);

    expect(disposeSpy).not.toHaveBeenCalled();
    expect(t.watcher).toBe(oldWatcher);
  });

  it('updateScope restarts watcher when additional workspaces change', () => {
    tracker.start();

    const t = tracker as any;
    const oldWatcher = t.watcher;
    const disposeSpy = vi.spyOn(oldWatcher, 'dispose');

    // Simulate a new workspace being added that resolves to a real project dir
    // We need to mock getProjectDirForWorkspace on the scanner
    const scannerSpy = vi.spyOn(t.scanner, 'getProjectDirForWorkspace');
    scannerSpy.mockReturnValue('/fake/project/dir');

    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, _defaultValue?: unknown) => ['/some/workspace']),
    });

    tracker.updateScope(undefined);

    expect(disposeSpy).toHaveBeenCalled();
    expect(t.watcher).not.toBe(oldWatcher);

    scannerSpy.mockRestore();
  });

  it('updateScope handles invalid paths gracefully', () => {
    tracker.start();

    const t = tracker as any;

    // Mock the config to return paths that won't resolve
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, _defaultValue?: unknown) => ['/nonexistent/path']),
    });

    // Should not throw
    expect(() => tracker.updateScope(undefined)).not.toThrow();

    // scopedProjectDirs should still be empty (no valid paths resolved)
    expect(t.scopedProjectDirs).toEqual([]);
  });
});

describe('SessionTracker per-session activity storage', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  function makeToolUseRecord(sessionId: string, timestamp: string, toolId: string): string {
    // Use stop_reason: null (streaming) to produce "working" status.
    return `{"type":"assistant","slug":"${sessionId}","sessionId":"${sessionId}","timestamp":"${timestamp}","message":{"model":"claude-sonnet-4-6","id":"msg-${toolId}","type":"message","role":"assistant","content":[{"type":"tool_use","id":"${toolId}","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`;
  }

  it('per-session activity storage prevents cross-session eviction', () => {
    const now = Date.now();

    // Create session A with 1 activity
    feedRecords(
      tracker,
      'session-a',
      JsonlParser.parseString(makeToolUseRecord('session-a', new Date(now).toISOString(), 'tu-a1'))
    );

    // Verify session A has an activity
    let state = tracker.getState('session-a');
    expect(state.activities.length).toBeGreaterThanOrEqual(1);
    expect(state.activities.some((a) => a.sessionId === 'session-a')).toBe(true);

    // Create session B with 300 activities (would have evicted A under old global 500-item buffer)
    const bRecords: string[] = [];
    for (let i = 0; i < 300; i++) {
      bRecords.push(
        makeToolUseRecord('session-b', new Date(now + i + 1).toISOString(), `tu-b${i}`)
      );
    }
    feedRecords(tracker, 'session-b', JsonlParser.parseString(bRecords.join('\n')));

    // Focus session A — its activity must still be present
    state = tracker.getState('session-a');
    expect(state.activities.length).toBeGreaterThanOrEqual(1);
    expect(state.activities.every((a) => a.sessionId === 'session-a')).toBe(true);
  });

  it('no-focus returns activities from all sessions in chronological order', () => {
    // Create session A with activities at T1, T3
    feedRecords(
      tracker,
      'session-x',
      JsonlParser.parseString(
        [
          makeToolUseRecord('session-x', '2026-02-25T10:00:01Z', 'tu-x1'),
          makeToolUseRecord('session-x', '2026-02-25T10:00:03Z', 'tu-x2'),
        ].join('\n')
      )
    );

    // Create session B with activities at T2, T4
    feedRecords(
      tracker,
      'session-y',
      JsonlParser.parseString(
        [
          makeToolUseRecord('session-y', '2026-02-25T10:00:02Z', 'tu-y1'),
          makeToolUseRecord('session-y', '2026-02-25T10:00:04Z', 'tu-y2'),
        ].join('\n')
      )
    );

    // getState(null) → activities should be in chronological order
    const state = tracker.getState(null);
    const timestamps = state.activities.map((a) => a.timestamp);

    // Verify chronological ordering
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] >= timestamps[i - 1]).toBe(true);
    }

    // Verify both sessions are represented
    const sessionIds = new Set(state.activities.map((a) => a.sessionId));
    expect(sessionIds.has('session-x')).toBe(true);
    expect(sessionIds.has('session-y')).toBe(true);

    // Verify interleaved ordering: x, y, x, y
    const sessionOrder = state.activities.map((a) => a.sessionId);
    expect(sessionOrder).toEqual(['session-x', 'session-y', 'session-x', 'session-y']);
  });

  it('cleanup removes activity buffer for stale sessions', () => {
    const oldTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    feedRecords(
      tracker,
      'stale-act',
      JsonlParser.parseString(makeToolUseRecord('stale-act', oldTimestamp, 'tu-stale'))
    );

    // Verify the activity buffer exists
    const t = tracker as any;
    expect(t.activitiesBySession.has('stale-act')).toBe(true);

    // Trigger cleanup — session is done (replay detection) + stale (>30 min)
    t.cleanupStaleSessions();

    // Activity buffer should be cleaned up too
    expect(t.activitiesBySession.has('stale-act')).toBe(false);
  });
});

describe('SessionTracker scope retry', () => {
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    outputChannel = (vscode.window as any).createOutputChannel('test');
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockGetConfiguration.mockReset();
  });

  it('starts scope retry when scoped-but-empty', () => {
    const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
    tracker.start();
    const t = tracker as any;

    // scopeRetryTimer should be set (scoped but empty → retry starts)
    expect(t.scopeRetryTimer).toBeDefined();

    tracker.dispose();
  });

  it('does not start scope retry when unscoped', () => {
    const tracker = new SessionTracker(outputChannel);
    tracker.start();
    const t = tracker as any;

    expect(t.scopeRetryTimer).toBeUndefined();

    tracker.dispose();
  });

  it('retry discovers the dir and restarts watcher', () => {
    const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
    tracker.start();
    const t = tracker as any;

    const oldWatcher = t.watcher;
    const disposeSpy = vi.spyOn(oldWatcher, 'dispose');

    // Initially scoped but empty
    expect(t.scopedProjectDirs).toEqual([]);

    // Mock resolveProjectDirs to simulate the dir appearing
    const resolvedDir = '/home/user/.claude/projects/-nonexistent-workspace';
    vi.spyOn(t.scanner, 'getProjectDirForWorkspace').mockReturnValue(resolvedDir);

    // Advance past the retry interval (30s)
    vi.advanceTimersByTime(30_000);

    // Watcher should have been restarted
    expect(disposeSpy).toHaveBeenCalled();
    expect(t.watcher).not.toBe(oldWatcher);
    expect(t.scopedProjectDirs).toEqual([resolvedDir]);

    tracker.dispose();
  });

  it('retry stops after success', () => {
    const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
    tracker.start();
    const t = tracker as any;

    expect(t.scopeRetryTimer).toBeDefined();

    // Mock dir appearing
    vi.spyOn(t.scanner, 'getProjectDirForWorkspace').mockReturnValue('/fake/dir');

    // Advance past retry interval — retry succeeds
    vi.advanceTimersByTime(30_000);

    // Timer should be cleared after success
    expect(t.scopeRetryTimer).toBeUndefined();

    tracker.dispose();
  });

  it('dispose cleans up the retry timer', () => {
    const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
    tracker.start();
    const t = tracker as any;

    expect(t.scopeRetryTimer).toBeDefined();

    tracker.dispose();

    expect(t.scopeRetryTimer).toBeUndefined();
  });
});

describe('SessionTracker scoping semantics', () => {
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    // Default: no additional workspaces
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
  });

  afterEach(() => {
    mockGetConfiguration.mockReset();
  });

  it('resolveProjectDirs returns undefined when no workspace and no additional workspaces', () => {
    const tracker = new SessionTracker(outputChannel);
    const t = tracker as any;
    expect(t.scopedProjectDirs).toBeUndefined();
    tracker.dispose();
  });

  it('resolveProjectDirs returns [] when workspace provided but dir does not exist', () => {
    const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
    const t = tracker as any;
    // Scoped (workspace provided) but empty (dir doesn't exist)
    expect(t.scopedProjectDirs).toEqual([]);
    tracker.dispose();
  });

  it('refresh scans nothing when scoped but empty', () => {
    const tracker = new SessionTracker(outputChannel, '/nonexistent/workspace');
    const t = tracker as any;

    // Spy on the scanner to verify what gets passed
    const scanSpy = vi.spyOn(t.scanner, 'scanSessionFiles');
    scanSpy.mockReturnValue([]);

    tracker.refresh();

    // Should be called with [] (scoped but empty), not undefined
    expect(scanSpy).toHaveBeenCalledWith([], expect.any(Number));

    scanSpy.mockRestore();
    tracker.dispose();
  });

  it('refresh scans all projects when unscoped (no workspace)', () => {
    const tracker = new SessionTracker(outputChannel);
    const t = tracker as any;

    const scanSpy = vi.spyOn(t.scanner, 'scanSessionFiles');
    scanSpy.mockReturnValue([]);

    tracker.refresh();

    // Should be called with undefined (unscoped)
    expect(scanSpy).toHaveBeenCalledWith(undefined, expect.any(Number));

    scanSpy.mockRestore();
    tracker.dispose();
  });
});

describe('SessionTracker lastAssistantText', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('populates lastAssistantText from a text content block', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'text-1',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"text-1","sessionId":"text-1","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Committed as 7d2671d. All files staged."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'text-1');
    expect(session).toBeDefined();
    expect(session!.lastAssistantText).toBe('Committed as 7d2671d. All files staged.');
  });

  it('does not set lastAssistantText when assistant has only tool_use blocks', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'tool-only',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"tool-only","sessionId":"tool-only","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'tool-only');
    expect(session).toBeDefined();
    expect(session!.lastAssistantText).toBeUndefined();
  });

  it('does not set lastAssistantText for whitespace-only text blocks', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'ws-only',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"ws-only","sessionId":"ws-only","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"   \\n  "}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'ws-only');
    expect(session).toBeDefined();
    expect(session!.lastAssistantText).toBeUndefined();
  });
});

describe('SessionTracker auto-naming', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;
  const mockGetConfiguration = vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('sets autoName from first user text for parent sessions', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'auto-1',
      JsonlParser.parseString(
        `{"type":"user","slug":"test-slug","sessionId":"auto-1","timestamp":"${now}","message":{"role":"user","content":[{"type":"text","text":"Help me fix the login bug"}]}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'auto-1');
    expect(session).toBeDefined();
    expect(session!.autoName).toBe('Help me fix the login bug');
  });

  it('does not overwrite autoName with subsequent user messages', () => {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 1000).toISOString();
    feedRecords(
      tracker,
      'auto-2',
      JsonlParser.parseString(
        [
          `{"type":"user","slug":"test-slug","sessionId":"auto-2","timestamp":"${now}","message":{"role":"user","content":[{"type":"text","text":"First prompt"}]}}`,
          `{"type":"user","slug":"test-slug","sessionId":"auto-2","timestamp":"${later}","message":{"role":"user","content":[{"type":"text","text":"Second prompt"}]}}`,
        ].join('\n')
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'auto-2');
    expect(session).toBeDefined();
    expect(session!.autoName).toBe('First prompt');
  });

  it('tool-result-only user records do not set autoName', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'auto-3',
      JsonlParser.parseString(
        `{"type":"user","slug":"test-slug","sessionId":"auto-3","timestamp":"${now}","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"file contents"}]}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'auto-3');
    expect(session).toBeDefined();
    expect(session!.autoName).toBeUndefined();
  });

  it('sub-agent gets both autoName and description', () => {
    const now = new Date().toISOString();
    feedRecords(
      tracker,
      'sub-auto-1',
      JsonlParser.parseString(
        `{"type":"user","slug":"sub-slug","sessionId":"parent-1","timestamp":"${now}","message":{"role":"user","content":[{"type":"text","text":"Search for authentication patterns"}]}}`
      ),
      { isSubAgent: true, parentSessionId: 'parent-1' }
    );

    const t = tracker as any;
    const session = t.sessions.get('sub-auto-1');
    expect(session).toBeDefined();
    expect(session.info.autoName).toBe('Search for authentication patterns');
    expect(session.description).toBe('Search for authentication patterns');
  });

  it('SubAgentInfo.description falls through to autoName when description is empty', () => {
    const now = new Date().toISOString();

    // Create parent
    feedRecords(
      tracker,
      'parent-desc',
      JsonlParser.parseString(
        `{"type":"user","slug":"parent","sessionId":"parent-desc","timestamp":"${now}","message":{"role":"user","content":[{"type":"text","text":"Main task"}]}}`
      )
    );

    // Create child with user text
    feedRecords(
      tracker,
      'child-desc',
      JsonlParser.parseString(
        `{"type":"user","slug":"child","sessionId":"parent-desc","timestamp":"${now}","message":{"role":"user","content":[{"type":"text","text":"Find auth code"}]}}`
      ),
      { isSubAgent: true, parentSessionId: 'parent-desc' }
    );

    const state = tracker.getState();
    const parent = state.sessions.find((s) => s.sessionId === 'parent-desc');
    expect(parent).toBeDefined();
    expect(parent!.childAgents).toBeDefined();

    const child = parent!.childAgents!.find((c) => c.sessionId === 'child-desc');
    expect(child).toBeDefined();
    expect(child!.description).toBe('Find auth code');
  });

  it('detects Write tool call to plans dir and sets pendingPlanCheck', () => {
    const now = new Date().toISOString();

    // Feed an assistant record with a Write tool call targeting the plans dir
    feedRecords(
      tracker,
      'plan-write',
      JsonlParser.parseString(
        `{"type":"assistant","slug":"plan-write","sessionId":"plan-write","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Write","input":{"file_path":"/home/user/.claude/plans/plan-write.md","content":"# Plan: Fix Login Bug"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
      )
    );

    const t = tracker as any;
    const session = t.sessions.get('plan-write');
    expect(session).toBeDefined();
    // pendingPlanCheck should have been set to true then consumed by handleRecords
    // After handleRecords, planTitleChecked should be true (the async check was triggered)
    expect(session.planTitleChecked).toBe(true);
  });
});

describe('SessionTracker artifact detection', () => {
  let tracker: SessionTracker;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    outputChannel = (vscode.window as any).createOutputChannel('test');
    tracker = new SessionTracker(outputChannel);
  });

  afterEach(() => {
    tracker.dispose();
  });

  it('marks episodic memory session as artifact', () => {
    const now = new Date().toISOString();

    // Feed a user record with "Context: " prefix (episodic memory pattern)
    feedRecords(
      tracker,
      'episodic-1',
      JsonlParser.parseString(
        `{"type":"user","sessionId":"episodic-1","slug":"episodic-1","timestamp":"${now}","message":{"role":"user","content":"Context: This summary will be shown to Claude in future conversations..."}}`
      )
    );
    // Feed an assistant record to get the session into a completed state
    feedRecords(
      tracker,
      'episodic-1',
      JsonlParser.parseString(
        `{"type":"assistant","sessionId":"episodic-1","slug":"episodic-1","timestamp":"${now}","message":{"model":"claude-haiku-4-5-20251001","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":10}}}`
      )
    );
    // Feed turn_duration to mark it as done
    feedRecords(
      tracker,
      'episodic-1',
      JsonlParser.parseString(
        `{"type":"system","subtype":"turn_duration","durationMs":500,"timestamp":"${now}"}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'episodic-1');
    expect(session).toBeDefined();
    expect(session!.isArtifact).toBe(true);
  });

  it('marks empty completed session as artifact', () => {
    // Just create the file, no records at all — session stays idle with 0 turns/tokens
    const sessionFile = {
      sessionId: 'empty-1',
      filePath: '/tmp/test/empty-1.jsonl',
      projectDir: 'test-project',
      isSubAgent: false,
      modifiedAt: new Date(),
    };
    const t = tracker as any;
    t.handleNewFile(sessionFile);

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'empty-1');
    expect(session).toBeDefined();
    // idle status + 0 turns + 0 tokens = artifact
    expect(session!.isArtifact).toBe(true);
  });

  it('does not mark normal session as artifact', () => {
    const now = new Date().toISOString();

    feedRecords(
      tracker,
      'normal-1',
      JsonlParser.parseString(
        `{"type":"user","sessionId":"normal-1","slug":"normal-1","timestamp":"${now}","message":{"role":"user","content":"Help me fix the bug"}}`
      )
    );
    feedRecords(
      tracker,
      'normal-1',
      JsonlParser.parseString(
        `{"type":"assistant","sessionId":"normal-1","slug":"normal-1","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"I'll help you fix that bug."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":200,"output_tokens":100}}}`
      )
    );
    feedRecords(
      tracker,
      'normal-1',
      JsonlParser.parseString(
        `{"type":"system","subtype":"turn_duration","durationMs":3000,"timestamp":"${now}"}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'normal-1');
    expect(session).toBeDefined();
    expect(session!.isArtifact).toBe(false);
  });

  it('does not mark active empty session as artifact', () => {
    const now = new Date().toISOString();

    // Feed a user record to make it active (thinking), but no assistant response yet
    feedRecords(
      tracker,
      'active-empty',
      JsonlParser.parseString(
        `{"type":"user","sessionId":"active-empty","slug":"active-empty","timestamp":"${now}","message":{"role":"user","content":"Do something"}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'active-empty');
    expect(session).toBeDefined();
    // 0 turns, 0 tokens, but status is thinking (not completed) — should NOT be artifact
    expect(session!.isArtifact).toBe(false);
  });

  it('does not mark session with tokens but 0 turns as artifact', () => {
    const now = new Date().toISOString();

    // Feed an assistant record with tokens but no turn completion
    feedRecords(
      tracker,
      'tokens-no-turns',
      JsonlParser.parseString(
        `{"type":"assistant","sessionId":"tokens-no-turns","slug":"tokens-no-turns","timestamp":"${now}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":500,"output_tokens":200}}}`
      )
    );

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'tokens-no-turns');
    expect(session).toBeDefined();
    // Has tokens, so not an empty artifact even if 0 turns
    expect(session!.isArtifact).toBe(false);
  });
});
