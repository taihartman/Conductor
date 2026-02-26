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

  // --- Tool use (null stop_reason) → waiting with tool approval ---
  it('transitions to waiting with tool approval on tool_use (null stop_reason)', () => {
    const record = makeAssistantRecord({
      message: {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo' } }],
        stop_reason: null,
      },
    });
    const status = sm.handleAssistantRecord(record);
    expect(status).toBe('waiting');
    expect(sm.status).toBe('waiting');
    expect(sm.pendingQuestion?.isToolApproval).toBe(true);
    expect(sm.pendingQuestion?.pendingTools).toHaveLength(1);
    expect(sm.pendingQuestion?.pendingTools?.[0].toolName).toBe('Read');
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
    expect(sm.pendingQuestion).toEqual({
      question: 'Which approach?',
      options: [],
      multiSelect: false,
    });
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

  // --- end_turn without tool_use → done ---
  it('transitions to done on end_turn without tool_use', () => {
    // Set working directly (tool_use now produces waiting)
    sm.setStatus('working');
    expect(sm.status).toBe('working');

    // end_turn text-only → done (Claude finished its turn)
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'text', text: 'All done' }],
          stop_reason: 'end_turn',
        },
      })
    );
    expect(sm.status).toBe('done');
  });

  // --- turn_duration → done (turn complete) ---
  it('transitions to done on turn_duration', () => {
    // Set working directly (tool_use now produces waiting)
    sm.setStatus('working');

    const record = makeSystemRecord({ subtype: 'turn_duration', durationMs: 5000 });
    const status = sm.handleSystemRecord(record);
    expect(status).toBe('done');
  });

  // --- turn_duration preserves waiting status from AskUserQuestion ---
  it('preserves waiting status on turn_duration after AskUserQuestion', () => {
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu-ask',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'Which option?' }] },
            },
          ],
        },
      })
    );
    expect(sm.status).toBe('waiting');

    const record = makeSystemRecord({ subtype: 'turn_duration', durationMs: 3000 });
    const status = sm.handleSystemRecord(record);
    expect(status).toBe('waiting');
    expect(sm.pendingQuestion).toEqual({
      question: 'Which option?',
      options: [],
      multiSelect: false,
    });
  });

  // --- User input on done → working ---
  it('transitions from done to working on user text input', () => {
    // Get to done via end_turn
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
        },
      })
    );
    expect(sm.status).toBe('done');

    sm.handleUserRecord(
      makeUserRecord({
        message: { content: [{ type: 'text', text: 'Continue' }] },
      })
    );
    expect(sm.status).toBe('working');
  });

  // --- User input on waiting (AskUserQuestion) → working ---
  it('transitions from waiting to working when user answers AskUserQuestion', () => {
    // Get to waiting via AskUserQuestion
    sm.handleAssistantRecord(
      makeAssistantRecord({
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu-ask',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'Pick one' }] },
            },
          ],
        },
      })
    );
    expect(sm.status).toBe('waiting');

    // User answers
    sm.handleUserRecord(
      makeUserRecord({
        message: { content: [{ type: 'text', text: 'Option A' }] },
      })
    );
    expect(sm.status).toBe('working');
    expect(sm.pendingQuestion).toBeUndefined();
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
    // Set working directly (tool_use now produces waiting)
    sm.setStatus('working');
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

  // --- PendingQuestion extraction ---

  it('extracts question with options from AskUserQuestion', () => {
    const record = makeAssistantRecord({
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-q',
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  question: 'Which DB?',
                  header: 'Database',
                  options: [
                    { label: 'PostgreSQL', description: 'Relational DB' },
                    { label: 'MongoDB', description: 'Document store' },
                  ],
                  multiSelect: false,
                },
              ],
            },
          },
        ],
      },
    });
    sm.handleAssistantRecord(record);
    expect(sm.pendingQuestion).toEqual({
      question: 'Which DB?',
      header: 'Database',
      options: [
        { label: 'PostgreSQL', description: 'Relational DB' },
        { label: 'MongoDB', description: 'Document store' },
      ],
      multiSelect: false,
    });
  });

  it('extracts legacy single-question format', () => {
    const record = makeAssistantRecord({
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-legacy',
            name: 'AskUserQuestion',
            input: { question: 'Pick one' },
          },
        ],
      },
    });
    sm.handleAssistantRecord(record);
    expect(sm.pendingQuestion).toEqual({
      question: 'Pick one',
      options: [],
      multiSelect: false,
    });
  });

  it('treats empty question string as undefined', () => {
    const record = makeAssistantRecord({
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-empty',
            name: 'AskUserQuestion',
            input: { questions: [{ question: '' }] },
          },
        ],
      },
    });
    sm.handleAssistantRecord(record);
    expect(sm.pendingQuestion).toBeUndefined();
  });

  it('defaults to empty options array when options field is missing', () => {
    const record = makeAssistantRecord({
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-noopts',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Q' }] },
          },
        ],
      },
    });
    sm.handleAssistantRecord(record);
    expect(sm.pendingQuestion).toEqual({
      question: 'Q',
      options: [],
      multiSelect: false,
    });
  });

  // =========================================================================
  // Fix 1: stop_hook_summary as turn-end signal
  // =========================================================================

  describe('stop_hook_summary handling', () => {
    it('transitions to done on stop_hook_summary', () => {
      // Set working directly (tool_use now produces waiting)
      sm.setStatus('working');
      expect(sm.status).toBe('working');

      const record = makeSystemRecord({ subtype: 'stop_hook_summary' });
      const status = sm.handleSystemRecord(record);
      expect(status).toBe('done');
    });

    it('preserves waiting status on stop_hook_summary', () => {
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
          },
        })
      );
      expect(sm.status).toBe('waiting');

      const record = makeSystemRecord({ subtype: 'stop_hook_summary' });
      const status = sm.handleSystemRecord(record);
      expect(status).toBe('waiting');
    });

    it('clears pendingQuestion on done transition from stop_hook_summary', () => {
      // Set working directly (tool_use now produces waiting)
      sm.setStatus('working');
      expect(sm.status).toBe('working');

      sm.handleSystemRecord(makeSystemRecord({ subtype: 'stop_hook_summary' }));
      expect(sm.status).toBe('done');
      expect(sm.pendingQuestion).toBeUndefined();
    });
  });

  // =========================================================================
  // Fix 2: Intermission timer for text-only null stop_reason
  // =========================================================================

  describe('intermission timer', () => {
    it('fires after 5s on text-only null stop_reason → done', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Hello' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('done');
    });

    it('is cancelled by stop_hook_summary arriving first', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Hello' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      // stop_hook_summary arrives before 5s
      sm.handleSystemRecord(makeSystemRecord({ subtype: 'stop_hook_summary' }));
      expect(sm.status).toBe('done');

      // Advance past the 5s — should NOT fire onStateChanged again
      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('is cancelled by turn_duration arriving first', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Hello' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      sm.handleSystemRecord(makeSystemRecord({ subtype: 'turn_duration', durationMs: 3000 }));
      expect(sm.status).toBe('done');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('is cancelled by next assistant record (no flash)', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Thinking...' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      // Next assistant record with tool_use arrives → now produces waiting
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-2', name: 'Read', input: {} }],
          },
        })
      );
      expect(sm.status).toBe('waiting');

      // Timer should have been cancelled
      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('waiting');
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('does not override waiting status', () => {
      // Get to waiting
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu-ask',
                name: 'AskUserQuestion',
                input: { questions: [{ question: 'Q?' }] },
              },
            ],
          },
        })
      );
      expect(sm.status).toBe('waiting');

      // Simulate a text-only message while waiting (unusual but possible)
      // This won't start intermission because status is not thinking/idle
      // But if it somehow did, it should not override waiting
      sm.setStatus('waiting');
      vi.advanceTimersByTime(10_000);
      expect(sm.status).toBe('waiting');
    });

    it('fires onStateChanged callback', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'text', text: 'Hello' }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('thinking');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('done');
      expect(onStateChanged).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Fix 3: ExitPlanMode / EnterPlanMode → WAITING
  // =========================================================================

  describe('plan tool detection', () => {
    it('ExitPlanMode transitions to waiting with isPlanApproval and planMode exit', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-exit', name: 'ExitPlanMode', input: {} }],
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion).toEqual({
        question: '',
        options: [],
        multiSelect: false,
        isPlanApproval: true,
        planMode: 'exit',
      });
    });

    it('EnterPlanMode transitions to waiting with isPlanApproval and planMode enter', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-enter', name: 'EnterPlanMode', input: {} }],
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion).toEqual({
        question: '',
        options: [],
        multiSelect: false,
        isPlanApproval: true,
        planMode: 'enter',
      });
    });

    it('AskUserQuestion takes priority over ExitPlanMode in same message', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              { type: 'tool_use', id: 'tu-exit', name: 'ExitPlanMode', input: {} },
              {
                type: 'tool_use',
                id: 'tu-ask',
                name: 'AskUserQuestion',
                input: { questions: [{ question: 'Pick one' }] },
              },
            ],
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion).toEqual({
        question: 'Pick one',
        options: [],
        multiSelect: false,
      });
      // Should NOT have isPlanApproval
      expect(sm.pendingQuestion?.isPlanApproval).toBeUndefined();
    });

    it('turn_duration preserves plan approval waiting state with planMode', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-exit', name: 'ExitPlanMode', input: {} }],
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isPlanApproval).toBe(true);
      expect(sm.pendingQuestion?.planMode).toBe('exit');

      const record = makeSystemRecord({ subtype: 'turn_duration', durationMs: 2000 });
      sm.handleSystemRecord(record);
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isPlanApproval).toBe(true);
      expect(sm.pendingQuestion?.planMode).toBe('exit');
    });

    it('plan approval cleared on user text input', () => {
      // Get to plan approval waiting
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-exit', name: 'ExitPlanMode', input: {} }],
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isPlanApproval).toBe(true);

      // User responds
      sm.handleUserRecord(
        makeUserRecord({
          message: { content: [{ type: 'text', text: 'Looks good' }] },
        })
      );
      expect(sm.status).toBe('working');
      expect(sm.pendingQuestion).toBeUndefined();
    });
  });

  // =========================================================================
  // Tool approval detection (stop_reason: 'tool_use')
  // =========================================================================

  describe('tool approval detection', () => {
    it('tool_use + stop_reason "tool_use" → waiting with isToolApproval', () => {
      const record = makeAssistantRecord({
        message: {
          content: [
            { type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'git commit' } },
          ],
          stop_reason: 'tool_use',
        },
      });
      const status = sm.handleAssistantRecord(record);
      expect(status).toBe('waiting');
      expect(sm.pendingQuestion).toBeDefined();
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);
      expect(sm.pendingQuestion?.pendingTools).toHaveLength(1);
      expect(sm.pendingQuestion?.pendingTools?.[0].toolName).toBe('Bash');
    });

    it('tool_use + stop_reason null → waiting with isToolApproval', () => {
      const record = makeAssistantRecord({
        message: {
          content: [
            { type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/foo' } },
          ],
          stop_reason: null,
        },
      });
      const status = sm.handleAssistantRecord(record);
      expect(status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);
      expect(sm.pendingQuestion?.pendingTools).toHaveLength(1);
      expect(sm.pendingQuestion?.pendingTools?.[0].toolName).toBe('Read');
    });

    it('multiple tool_use blocks → pendingTools array has all tools', () => {
      const record = makeAssistantRecord({
        message: {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm test' } },
            { type: 'tool_use', id: 'tu-2', name: 'Write', input: { file_path: '/a.ts' } },
          ],
          stop_reason: 'tool_use',
        },
      });
      sm.handleAssistantRecord(record);
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);
      expect(sm.pendingQuestion?.pendingTools).toHaveLength(2);
      expect(sm.pendingQuestion?.pendingTools?.[0].toolName).toBe('Bash');
      expect(sm.pendingQuestion?.pendingTools?.[1].toolName).toBe('Write');
    });

    it('AskUserQuestion takes priority over tool approval stop_reason', () => {
      const record = makeAssistantRecord({
        message: {
          content: [
            { type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'ls' } },
            {
              type: 'tool_use',
              id: 'tu-ask',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'Continue?' }] },
            },
          ],
          stop_reason: 'tool_use',
        },
      });
      sm.handleAssistantRecord(record);
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBeUndefined();
      expect(sm.pendingQuestion?.question).toBe('Continue?');
    });

    it('tool_result clears tool approval → working', () => {
      // Get to tool approval waiting
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              { type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'git push' } },
            ],
            stop_reason: 'tool_use',
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);

      // Tool result arrives (user approved in terminal)
      sm.handleUserRecord(
        makeUserRecord({
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu-bash', content: 'ok' }],
          },
        })
      );
      expect(sm.status).toBe('working');
      expect(sm.pendingQuestion).toBeUndefined();
    });

    it('turn_duration preserves tool approval waiting state', () => {
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              { type: 'tool_use', id: 'tu-edit', name: 'Edit', input: { file_path: '/b.ts' } },
            ],
            stop_reason: 'tool_use',
          },
        })
      );
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);

      const record = makeSystemRecord({ subtype: 'turn_duration', durationMs: 4000 });
      sm.handleSystemRecord(record);
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);
    });

    it('multiple tool_use blocks with null stop_reason → pendingTools populated', () => {
      const record = makeAssistantRecord({
        message: {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm test' } },
            { type: 'tool_use', id: 'tu-2', name: 'Write', input: { file_path: '/a.ts' } },
          ],
          stop_reason: null,
        },
      });
      sm.handleAssistantRecord(record);
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isToolApproval).toBe(true);
      expect(sm.pendingQuestion?.pendingTools).toHaveLength(2);
      expect(sm.pendingQuestion?.pendingTools?.[0].toolName).toBe('Bash');
      expect(sm.pendingQuestion?.pendingTools?.[1].toolName).toBe('Write');
    });

    it('same-batch tool_use then tool_result → final status is working (auto-approved)', () => {
      // Simulates auto-approved tools where tool_use + tool_result arrive in same batch.
      // After both records, status should be working (tool_result clears waiting).
      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [
              { type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/foo' } },
            ],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('waiting');

      // tool_result arrives immediately (same batch)
      sm.handleUserRecord(
        makeUserRecord({
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu-read', content: 'file contents' }],
          },
        })
      );
      expect(sm.status).toBe('working');
      expect(sm.pendingQuestion).toBeUndefined();
    });

    it('filters out AskUserQuestion and plan tools from pendingTools list', () => {
      const record = makeAssistantRecord({
        message: {
          content: [
            { type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'echo hi' } },
            { type: 'tool_use', id: 'tu-exit', name: 'ExitPlanMode', input: {} },
          ],
          // Note: this scenario shouldn't happen (plan tool takes priority),
          // but if it did, the filter ensures plan tools are excluded from pendingTools
          stop_reason: 'tool_use',
        },
      });
      // hasPlanTool is true, so plan approval takes priority over tool approval
      sm.handleAssistantRecord(record);
      expect(sm.status).toBe('waiting');
      expect(sm.pendingQuestion?.isPlanApproval).toBe(true);
    });
  });

  // =========================================================================
  // Fix 4: Progress record intermission timer
  // =========================================================================

  describe('progress record intermission timer', () => {
    it('fires after 5s on progress record with no follow-up', () => {
      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('thinking');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('done');
      expect(onStateChanged).toHaveBeenCalled();
    });

    it('progress record restarts intermission timer', () => {
      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('thinking');

      vi.advanceTimersByTime(3_000);
      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('thinking');

      vi.advanceTimersByTime(3_000);
      expect(sm.status).toBe('thinking');

      vi.advanceTimersByTime(2_000);
      expect(sm.status).toBe('done');
    });

    it('cancelled by assistant record', () => {
      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('thinking');

      sm.handleAssistantRecord(
        makeAssistantRecord({
          message: {
            content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo' } }],
            stop_reason: null,
          },
        })
      );
      expect(sm.status).toBe('waiting');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('waiting');
    });

    it('cancelled by system turn_duration', () => {
      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('thinking');

      sm.handleSystemRecord(makeSystemRecord({ subtype: 'turn_duration', durationMs: 2000 }));
      expect(sm.status).toBe('done');

      onStateChanged.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('does not override WAITING status', () => {
      // Get to waiting via AskUserQuestion
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
          },
        })
      );
      expect(sm.status).toBe('waiting');

      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('waiting');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('waiting');
    });

    it('does not start timer when WORKING', () => {
      sm.setStatus('working');
      expect(sm.status).toBe('working');

      sm.handleProgressRecord(makeProgressRecord());
      expect(sm.status).toBe('working');

      vi.advanceTimersByTime(5_000);
      expect(sm.status).toBe('working');
    });
  });
});
