import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStateMachine } from '../monitoring/SessionStateMachine';
import { AssistantRecord, UserRecord, SystemRecord, ProgressRecord } from '../models/types';

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

function makeUserRecord(
  overrides: Partial<UserRecord> & { message?: Partial<UserRecord['message']> } = {}
): UserRecord {
  const { message: msgOverrides, ...rest } = overrides;
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [],
      ...msgOverrides,
    },
    ...rest,
  };
}

function makeSystemRecord(overrides: Partial<SystemRecord> = {}): SystemRecord {
  return {
    type: 'system',
    ...overrides,
  };
}

function makeProgressRecord(overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    type: 'progress',
    ...overrides,
  };
}

describe('SessionStateMachine', () => {
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

  it('starts in idle state', () => {
    expect(sm.status).toBe('idle');
  });

  // --- Tool use → working ---
  it('transitions to working on tool_use', () => {
    const record = makeAssistantRecord({
      message: {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo' } }],
        stop_reason: null,
      },
    });
    const status = sm.handleAssistantRecord(record);
    expect(status).toBe('working');
    expect(sm.status).toBe('working');
  });

  // --- Text-only, not end_turn → thinking ---
  it('transitions to thinking on text-only assistant (stop_reason != end_turn)', () => {
    const record = makeAssistantRecord({
      message: {
        content: [{ type: 'text', text: 'Let me think about this...' }],
        stop_reason: null,
      },
    });
    const status = sm.handleAssistantRecord(record);
    expect(status).toBe('thinking');
    expect(sm.status).toBe('thinking');
  });

  // --- AskUserQuestion → waiting + pendingQuestion ---
  it('transitions to waiting on AskUserQuestion', () => {
    const record = makeAssistantRecord({
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-2',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Which approach?' }] },
          },
        ],
        stop_reason: null,
      },
    });
    const status = sm.handleAssistantRecord(record);
    expect(status).toBe('waiting');
    expect(sm.pendingQuestion).toBe('Which approach?');
  });

  // --- Tool result (non-error) → working ---
  it('transitions to working on non-error tool_result', () => {
    const record = makeUserRecord({
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
      },
    });
    const status = sm.handleUserRecord(record);
    expect(status).toBe('working');
  });

  // --- User text input → working ---
  it('transitions to working on user text input', () => {
    const record = makeUserRecord({
      message: {
        content: [{ type: 'text', text: 'Do something' }],
      },
    });
    const status = sm.handleUserRecord(record);
    expect(status).toBe('working');
  });

  // --- 3+ errors in 60s → error ---
  it('transitions to error on 3+ tool errors in 60s', () => {
    // Three error tool results
    for (let i = 0; i < 3; i++) {
      sm.handleUserRecord(
        makeUserRecord({
          message: {
            content: [
              { type: 'tool_result', tool_use_id: `tu-${i}`, content: 'error', is_error: true },
            ],
          },
        })
      );
    }
    expect(sm.status).toBe('error');
    expect(sm.recentErrorCount).toBe(3);
  });

  // --- Non-error result clears error → working ---
  it('clears error state on non-error tool_result', () => {
    // Push into error state
    for (let i = 0; i < 3; i++) {
      sm.handleUserRecord(
        makeUserRecord({
          message: {
            content: [
              { type: 'tool_result', tool_use_id: `tu-${i}`, content: 'error', is_error: true },
            ],
          },
        })
      );
    }
    expect(sm.status).toBe('error');

    // Non-error result should clear error
    sm.handleUserRecord(
      makeUserRecord({
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu-ok', content: 'success' }],
        },
      })
    );
    expect(sm.status).toBe('working');
  });

  // --- end_turn without tool_use → waiting ---
  it('transitions to waiting on end_turn without tool_use', () => {
    // First make it working via tool call
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }],
        },
      })
    );
    expect(sm.status).toBe('working');

    // end_turn text-only → waiting (Claude is ready for user input)
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'text', text: 'All done' }],
          stop_reason: 'end_turn',
        },
      })
    );
    expect(sm.status).toBe('waiting');
  });

  // --- turn_duration → waiting (turn complete, awaiting next user message) ---
  it('transitions to waiting on turn_duration', () => {
    // Make working first
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: {} }],
        },
      })
    );

    const record = makeSystemRecord({ subtype: 'turn_duration', durationMs: 5000 });
    const status = sm.handleSystemRecord(record);
    expect(status).toBe('waiting');
  });

  // --- User input on waiting → working ---
  it('transitions from waiting to working on user text input', () => {
    // Get to waiting via end_turn
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
        },
      })
    );
    expect(sm.status).toBe('waiting');

    sm.handleUserRecord(
      makeUserRecord({
        message: { content: [{ type: 'text', text: 'Continue' }] },
      })
    );
    expect(sm.status).toBe('working');
  });

  // --- User input transitions from waiting back to working ---
  it('transitions from waiting to working when user provides new input', () => {
    // Make working, then waiting via end_turn
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }],
        },
      })
    );
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
        },
      })
    );
    expect(sm.status).toBe('waiting');

    // New user input
    sm.handleUserRecord(
      makeUserRecord({
        message: { content: [{ type: 'text', text: 'More' }] },
      })
    );
    expect(sm.status).toBe('working');
  });

  // --- Error counter resets on user text input ---
  it('resets error counter on user text input', () => {
    // Accumulate 2 errors
    for (let i = 0; i < 2; i++) {
      sm.handleUserRecord(
        makeUserRecord({
          message: {
            content: [
              { type: 'tool_result', tool_use_id: `tu-${i}`, content: 'err', is_error: true },
            ],
          },
        })
      );
    }
    expect(sm.recentErrorCount).toBe(2);

    // User text input resets counter
    sm.handleUserRecord(
      makeUserRecord({
        message: { content: [{ type: 'text', text: 'Retry' }] },
      })
    );
    expect(sm.recentErrorCount).toBe(0);
  });

  // --- Malformed record → no crash, status unchanged ---
  it('handles assistant record with no message gracefully', () => {
    const record = { type: 'assistant' } as AssistantRecord;
    const status = sm.handleAssistantRecord(record);
    expect(status).toBe('idle');
  });

  it('handles user record with no message gracefully', () => {
    const record = { type: 'user' } as UserRecord;
    const status = sm.handleUserRecord(record);
    expect(status).toBe('idle');
  });

  // --- Undefined stop_reason → treated as thinking ---
  it('treats undefined stop_reason as thinking for text-only', () => {
    const record = makeAssistantRecord({
      message: {
        content: [{ type: 'text', text: 'Processing...' }],
        stop_reason: null,
      },
    });
    sm.handleAssistantRecord(record);
    expect(sm.status).toBe('thinking');
  });

  // --- Progress record → thinking if not working ---
  it('transitions to thinking on progress record', () => {
    const record = makeProgressRecord();
    const status = sm.handleProgressRecord(record);
    expect(status).toBe('thinking');
  });

  it('stays working on progress record if already working', () => {
    // First make working
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: {} }],
        },
      })
    );
    expect(sm.status).toBe('working');

    sm.handleProgressRecord(makeProgressRecord());
    expect(sm.status).toBe('working');
  });

  // --- Tracking ---
  it('tracks lastStopReason and lastAssistantTime', () => {
    expect(sm.lastStopReason).toBeNull();
    expect(sm.lastAssistantTime).toBe(0);

    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
        },
      })
    );

    expect(sm.lastStopReason).toBe('end_turn');
    expect(sm.lastAssistantTime).toBeGreaterThan(0);
  });

  // --- Dispose ---
  it('dispose cleans up without error', () => {
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }],
        },
      })
    );
    expect(() => sm.dispose()).not.toThrow();
  });

  // --- Error window expiry ---
  it('errors expire after 60s window', () => {
    // Add 2 errors
    for (let i = 0; i < 2; i++) {
      sm.handleUserRecord(
        makeUserRecord({
          message: {
            content: [
              { type: 'tool_result', tool_use_id: `tu-${i}`, content: 'err', is_error: true },
            ],
          },
        })
      );
    }
    expect(sm.recentErrorCount).toBe(2);

    // Advance 61s — errors should expire
    vi.advanceTimersByTime(61_000);
    expect(sm.recentErrorCount).toBe(0);
  });

  it('setStatus overrides current status', () => {
    expect(sm.status).toBe('idle');
    sm.setStatus('done');
    expect(sm.status).toBe('done');
  });
});
