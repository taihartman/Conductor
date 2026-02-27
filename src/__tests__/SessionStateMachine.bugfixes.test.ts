/**
 * Tests for the 5 bug fixes in SessionStateMachine (Part 1 of hooks plan).
 *
 * Fix 1: stop_reason discrimination (tool_use → WAITING, null → WORKING)
 * Fix 2: No intermission timer from progress records
 * Fix 3: Intermission timer only on THINKING transition
 * Fix 4: Timer guarded against WORKING and ERROR
 * Fix 5: setStatus() cancels timers + overrideStatus()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStateMachine } from '../monitoring/SessionStateMachine';
import { AssistantRecord, ProgressRecord } from '../models/types';

function makeAssistantRecord(
  overrides: Partial<AssistantRecord> & { message?: Partial<AssistantRecord['message']> } = {}
): AssistantRecord {
  const { message: msgOverrides, ...rest } = overrides;
  return {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-20250514',
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
      ...msgOverrides,
    },
    ...rest,
  };
}

function makeProgressRecord(overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    type: 'progress',
    ...overrides,
  };
}

describe('SessionStateMachine bug fixes', () => {
  let onStateChanged: ReturnType<typeof vi.fn>;
  let sm: SessionStateMachine;

  beforeEach(() => {
    vi.useFakeTimers();
    onStateChanged = vi.fn();
    sm = new SessionStateMachine(onStateChanged);
  });

  afterEach(() => {
    sm.dispose();
    vi.useRealTimers();
  });

  // =========================================================================
  // Fix 1: stop_reason discrimination
  // =========================================================================

  describe('Fix 1: stop_reason discrimination', () => {
    it('tool_use + stop_reason "tool_use" → WAITING with tool approval', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm test' } },
            ],
            stop_reason: 'tool_use',
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);
    });

    it('tool_use + stop_reason null → WORKING (auto-approved)', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo' } }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('working');
      expect(sm.pendingQuestion).toBeUndefined();
    });

    it('tool_use + end_turn stop_reason with tool blocks → WORKING', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/bar' } }],
            stop_reason: 'end_turn',
          },
        })
      );
      // end_turn with tool blocks → not 'tool_use' stop_reason → WORKING
      expect(sm.status).toBe('working');
    });

    it('AskUserQuestion always → WAITING regardless of stop_reason', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu-ask',
                name: 'AskUserQuestion',
                input: { questions: [{ question: 'Which?' }] },
              },
            ],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.question).toBe('Which?');
    });
  });

  // =========================================================================
  // Fix 2: No intermission timer from progress records
  // =========================================================================

  describe('Fix 2: progress records do not start intermission timer', () => {
    it('progress record → THINKING but no timer (stays thinking after 5s)', () => {
      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('thinking');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('thinking');
    });

    it('progress record does not fire onStateChanged after 5s', () => {
      sm.handleProgressRecord(makeProgressRecord());
      onStateChanged.mockClear();

      vi.advanceTimersByTime(10_000);
      expect(onStateChanged).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Fix 3: Intermission timer only on THINKING transition
  // =========================================================================

  describe('Fix 3: intermission timer only when transitioning to THINKING', () => {
    it('text-only with null stop_reason transitions to THINKING and starts timer', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Processing...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      // Timer fires after 5s
      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('done');
    });

    it('no timer when staying in WORKING (text-only while WORKING)', () => {
      sm.setStatus('working');

      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Still working...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('working');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(10_000);
      expect(sm.status).toBe('working');
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('no timer when staying in ERROR (text-only while ERROR)', () => {
      sm.setStatus('error');

      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Error context...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('error');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(10_000);
      expect(sm.status).toBe('error');
      expect(onStateChanged).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Fix 4: Timer guarded against WORKING and ERROR
  // =========================================================================

  describe('Fix 4: intermission timer callback guarded against WORKING/ERROR', () => {
    it('timer does not fire if status changed to WORKING before timeout', () => {
      // Start timer via text-only → thinking
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Thinking...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      // External status override to working (simulating hook event)
      sm.overrideStatus('working');
      expect(sm.status).toBe('working');

      // Timer fires but guard prevents override
      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('working');
    });

    it('timer does not fire if status changed to ERROR before timeout', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Thinking...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      sm.overrideStatus('error');
      expect(sm.status).toBe('error');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('error');
    });
  });

  // =========================================================================
  // Fix 5: setStatus cancels timers + overrideStatus
  // =========================================================================

  describe('Fix 5: setStatus cancels timers + overrideStatus', () => {
    it('setStatus cancels pending intermission timer', () => {
      // Start timer
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Thinking...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      // setStatus should cancel the timer
      sm.setStatus('working');
      expect(sm.status).toBe('working');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('working');
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('overrideStatus cancels timers and sets status', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Thinking...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      sm.overrideStatus('waiting');
      expect(sm.status).toBe('waiting');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('waiting');
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('recordHookError tracks errors for threshold check', () => {
      expect(sm.recentErrorCount).toBe(0);

      sm.recordHookError('Bash');
      sm.recordHookError('Write');
      sm.recordHookError('Edit');

      expect(sm.recentErrorCount).toBe(3);
    });

    it('hook errors expire after 60s window', () => {
      sm.recordHookError('Bash');
      sm.recordHookError('Write');
      expect(sm.recentErrorCount).toBe(2);

      vi.advanceTimersByTime(61_000);
      expect(sm.recentErrorCount).toBe(0);
    });
  });
});
