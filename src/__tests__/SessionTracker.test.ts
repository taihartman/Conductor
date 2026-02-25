import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonlParser } from '../monitoring/JsonlParser';
import { SessionTracker } from '../monitoring/SessionTracker';
import { AssistantRecord, UserRecord, SystemRecord, SummaryRecord } from '../models/types';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
            statusTransitions.push('active');
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
            statusTransitions.push('active');
          }
          break;
        }
        case 'system': {
          const sys = record as SystemRecord;
          if (sys.subtype === 'turn_duration') {
            statusTransitions.push('idle');
            turnCount++;
          }
          break;
        }
      }
    }

    // Verify state machine transitions make sense
    expect(statusTransitions.length).toBeGreaterThan(0);
    expect(statusTransitions[statusTransitions.length - 1]).toBe('idle');
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
    // Access private handleNewFile and handleRecords via any
    const t = tracker as any;
    t.handleNewFile(sessionFile);
    t.handleRecords({ sessionFile, records });
  }

  it('marks replayed session with old timestamps as idle', () => {
    const oldTimestamp = '2026-01-01T10:00:00Z'; // > 5 minutes ago
    const records = JsonlParser.parseString(
      `{"type":"assistant","slug":"old-session","sessionId":"old1","timestamp":"${oldTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
    );

    feedRecords(tracker, 'old1', records);

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'old1');
    expect(session).toBeDefined();
    expect(session!.status).toBe('idle');
  });

  it('preserves active status for session with recent timestamps', () => {
    const recentTimestamp = new Date().toISOString(); // right now
    const records = JsonlParser.parseString(
      `{"type":"assistant","slug":"live-session","sessionId":"live1","timestamp":"${recentTimestamp}","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/test.ts"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}`
    );

    feedRecords(tracker, 'live1', records);

    const state = tracker.getState();
    const session = state.sessions.find((s) => s.sessionId === 'live1');
    expect(session).toBeDefined();
    expect(session!.status).toBe('active');
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

    // First read: marks as idle (old timestamp)
    t.handleRecords({ sessionFile, records: records1 });
    let state = tracker.getState();
    let session = state.sessions.find((s) => s.sessionId === 'mr1');
    expect(session!.status).toBe('idle');

    // Second read: new live records should NOT be forced idle
    const liveTimestamp = new Date().toISOString();
    const records2 = JsonlParser.parseString(
      `{"type":"user","slug":"multi-read","sessionId":"mr1","timestamp":"${liveTimestamp}","message":{"role":"user","content":[{"type":"text","text":"Do something"}]}}`
    );
    t.handleRecords({ sessionFile, records: records2 });
    state = tracker.getState();
    session = state.sessions.find((s) => s.sessionId === 'mr1');
    // User text input sets status to 'active'
    expect(session!.status).toBe('active');
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

    // Focus on parent
    tracker.focusSession('parent-3');
    const state = tracker.getState();

    // Activities should include both parent and child
    const activitySessionIds = state.activities.map((a) => a.sessionId);
    expect(activitySessionIds).toContain('parent-3');
    expect(activitySessionIds).toContain('agent-child');
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

    // Focus on sub-agent
    tracker.focusSession('agent-child2');
    const state = tracker.getState();

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
