import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HookEventWatcher } from '../monitoring/HookEventWatcher';
import { HookEvent } from '../models/types';

describe('HookEventWatcher', () => {
  let tmpDir: string;
  let watcher: HookEventWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-hook-test-'));
    watcher = new HookEventWatcher(tmpDir);
  });

  afterEach(() => {
    watcher.dispose();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEventLine(sessionId: string, line: string): void {
    const filePath = path.join(tmpDir, `${sessionId}.jsonl`);
    fs.appendFileSync(filePath, line + '\n');
  }

  function collectEvents(): Array<{ sessionId: string; events: HookEvent[] }> {
    const collected: Array<{ sessionId: string; events: HookEvent[] }> = [];
    watcher.onHookEvents(({ sessionId, events }) => {
      collected.push({ sessionId, events });
    });
    return collected;
  }

  it('emits events from a new session file on start', () => {
    writeEventLine('sess-1', '{"e":"SessionStart","ts":1000,"sid":"sess-1"}');
    const collected = collectEvents();

    watcher.start();

    expect(collected).toHaveLength(1);
    expect(collected[0].sessionId).toBe('sess-1');
    expect(collected[0].events).toHaveLength(1);
    expect(collected[0].events[0].e).toBe('SessionStart');
    expect(collected[0].events[0].ts).toBe(1000);
    expect(collected[0].events[0].sid).toBe('sess-1');
  });

  it('reads incrementally — only new lines on subsequent polls', () => {
    writeEventLine('sess-2', '{"e":"SessionStart","ts":1000,"sid":"sess-2"}');
    const collected = collectEvents();

    watcher.start();
    expect(collected).toHaveLength(1);

    // Write more events
    writeEventLine('sess-2', '{"e":"PreToolUse","ts":1001,"sid":"sess-2","tool":"Bash"}');
    writeEventLine('sess-2', '{"e":"PostToolUse","ts":1002,"sid":"sess-2","tool":"Bash"}');

    vi.advanceTimersByTime(1_000);

    expect(collected).toHaveLength(2);
    expect(collected[1].events).toHaveLength(2);
    expect(collected[1].events[0].e).toBe('PreToolUse');
    expect(collected[1].events[0].tool).toBe('Bash');
    expect(collected[1].events[1].e).toBe('PostToolUse');
  });

  it('handles multiple session files', () => {
    writeEventLine('sess-a', '{"e":"SessionStart","ts":1000,"sid":"sess-a"}');
    writeEventLine('sess-b', '{"e":"Stop","ts":1001,"sid":"sess-b"}');
    const collected = collectEvents();

    watcher.start();

    expect(collected).toHaveLength(2);
    const sessionIds = collected.map((c) => c.sessionId).sort();
    expect(sessionIds).toEqual(['sess-a', 'sess-b']);
  });

  it('skips malformed JSON lines', () => {
    writeEventLine('sess-3', '{"e":"SessionStart","ts":1000,"sid":"sess-3"}');
    writeEventLine('sess-3', 'not-json');
    writeEventLine('sess-3', '{"e":"Stop","ts":1002,"sid":"sess-3"}');
    const collected = collectEvents();

    watcher.start();

    expect(collected).toHaveLength(1);
    expect(collected[0].events).toHaveLength(2);
    expect(collected[0].events[0].e).toBe('SessionStart');
    expect(collected[0].events[1].e).toBe('Stop');
  });

  it('skips lines missing required fields (e, ts, sid)', () => {
    writeEventLine('sess-4', '{"e":"SessionStart","ts":1000,"sid":"sess-4"}');
    writeEventLine('sess-4', '{"e":"Stop","ts":1001}'); // missing sid
    writeEventLine('sess-4', '{"ts":1002,"sid":"sess-4"}'); // missing e
    writeEventLine('sess-4', '{"e":"Stop","sid":"sess-4"}'); // missing ts
    const collected = collectEvents();

    watcher.start();

    expect(collected).toHaveLength(1);
    expect(collected[0].events).toHaveLength(1);
    expect(collected[0].events[0].e).toBe('SessionStart');
  });

  it('handles partial line at end of file (line buffer)', () => {
    // Write a complete line and a partial line (no trailing newline)
    const filePath = path.join(tmpDir, 'sess-5.jsonl');
    fs.writeFileSync(
      filePath,
      '{"e":"SessionStart","ts":1000,"sid":"sess-5"}\n{"e":"Stop","ts":10'
    );
    const collected = collectEvents();

    watcher.start();

    // Only the complete line should be emitted
    expect(collected).toHaveLength(1);
    expect(collected[0].events).toHaveLength(1);
    expect(collected[0].events[0].e).toBe('SessionStart');

    // Complete the partial line
    fs.appendFileSync(filePath, '01,"sid":"sess-5"}\n');
    vi.advanceTimersByTime(1_000);

    expect(collected).toHaveLength(2);
    expect(collected[1].events).toHaveLength(1);
    expect(collected[1].events[0].e).toBe('Stop');
  });

  it('handles non-existent events directory gracefully', () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist');
    const w = new HookEventWatcher(nonExistent);
    const collected: Array<{ sessionId: string; events: HookEvent[] }> = [];
    w.onHookEvents(({ sessionId, events }) => {
      collected.push({ sessionId, events });
    });

    // Should not throw
    w.start();
    vi.advanceTimersByTime(1_000);
    expect(collected).toHaveLength(0);

    w.dispose();
  });

  it('ignores non-.jsonl files', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'ignore me');
    const collected = collectEvents();

    watcher.start();
    expect(collected).toHaveLength(0);
  });

  it('cleans up trackers for deleted files', () => {
    writeEventLine('sess-6', '{"e":"SessionStart","ts":1000,"sid":"sess-6"}');
    const collected = collectEvents();

    watcher.start();
    expect(collected).toHaveLength(1);

    // Delete the file
    fs.unlinkSync(path.join(tmpDir, 'sess-6.jsonl'));
    vi.advanceTimersByTime(1_000);

    // Write a new event for a different session
    writeEventLine('sess-7', '{"e":"SessionStart","ts":1000,"sid":"sess-7"}');
    vi.advanceTimersByTime(1_000);

    expect(collected).toHaveLength(2);
    expect(collected[1].sessionId).toBe('sess-7');
  });

  it('parses optional fields (tool, err, ntype)', () => {
    writeEventLine(
      'sess-8',
      '{"e":"PostToolUseFailure","ts":1000,"sid":"sess-8","tool":"Bash","err":"exit 1"}'
    );
    writeEventLine('sess-8', '{"e":"Notification","ts":1001,"sid":"sess-8","ntype":"idle_prompt"}');
    const collected = collectEvents();

    watcher.start();

    expect(collected).toHaveLength(1);
    expect(collected[0].events).toHaveLength(2);

    const failure = collected[0].events[0];
    expect(failure.e).toBe('PostToolUseFailure');
    expect(failure.tool).toBe('Bash');
    expect(failure.err).toBe('exit 1');

    const notification = collected[0].events[1];
    expect(notification.e).toBe('Notification');
    expect(notification.ntype).toBe('idle_prompt');
  });

  it('does not emit when no new events', () => {
    writeEventLine('sess-9', '{"e":"SessionStart","ts":1000,"sid":"sess-9"}');
    const collected = collectEvents();

    watcher.start();
    expect(collected).toHaveLength(1);

    // Poll again — no new data
    vi.advanceTimersByTime(1_000);
    expect(collected).toHaveLength(1);
  });

  it('dispose stops polling', () => {
    const collected = collectEvents();
    watcher.start();

    writeEventLine('sess-10', '{"e":"SessionStart","ts":1000,"sid":"sess-10"}');
    vi.advanceTimersByTime(1_000);
    expect(collected).toHaveLength(1);

    watcher.dispose();

    writeEventLine('sess-10', '{"e":"Stop","ts":1001,"sid":"sess-10"}');
    vi.advanceTimersByTime(1_000);
    // No new events after dispose
    expect(collected).toHaveLength(1);
  });
});
