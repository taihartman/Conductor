import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationBuilder } from '../monitoring/ConversationBuilder';
import { AssistantRecord, UserRecord, SystemRecord, SummaryRecord } from '../models/types';
import { MAX_CONVERSATION_TURNS_PER_SESSION, TRUNCATION } from '../constants';

function makeAssistantRecord(overrides: Partial<AssistantRecord> = {}): AssistantRecord {
  return {
    type: 'assistant',
    timestamp: '2025-01-01T00:00:00Z',
    message: {
      model: 'claude-sonnet-4-6',
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    ...overrides,
  };
}

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    type: 'user',
    timestamp: '2025-01-01T00:00:01Z',
    message: {
      role: 'user',
      content: [],
    },
    ...overrides,
  };
}

function makeSystemRecord(overrides: Partial<SystemRecord> = {}): SystemRecord {
  return {
    type: 'system',
    timestamp: '2025-01-01T00:00:02Z',
    ...overrides,
  };
}

function makeSummaryRecord(overrides: Partial<SummaryRecord> = {}): SummaryRecord {
  return {
    type: 'summary',
    timestamp: '2025-01-01T00:00:03Z',
    ...overrides,
  };
}

describe('ConversationBuilder', () => {
  let builder: ConversationBuilder;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    builder = new ConversationBuilder();
  });

  function getConversation(
    focusedId: string = sessionId
  ): ReturnType<typeof builder.getFilteredConversation> {
    return builder.getFilteredConversation(
      focusedId,
      new Map([[focusedId, { isSubAgent: false }]])
    );
  }

  it('creates an assistant turn with text and tool_use', () => {
    const record = makeAssistantRecord({
      message: {
        model: 'claude-sonnet-4-6',
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo/bar.ts' } },
        ],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    builder.processAssistant(sessionId, record);
    const turns = getConversation();

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].text).toBe('Let me read the file.');
    expect(turns[0].tools).toHaveLength(1);
    expect(turns[0].tools![0].toolName).toBe('Read');
    expect(turns[0].tools![0].toolUseId).toBe('tu-1');
    expect(turns[0].tools![0].inputSummary).toBe('/foo/bar.ts');
    expect(turns[0].model).toBe('claude-sonnet-4-6');
    expect(turns[0].usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it('pairs tool_result with matching tool_use', () => {
    const assistantRecord = makeAssistantRecord({
      message: {
        model: 'claude-sonnet-4-6',
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo.ts' } }],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'file contents here' }],
      },
    });

    builder.processAssistant(sessionId, assistantRecord);
    builder.processUser(sessionId, userRecord);

    const turns = getConversation();
    expect(turns).toHaveLength(1); // Only assistant turn (user has no text)
    expect(turns[0].tools![0].output).toBe('file contents here');
    expect(turns[0].tools![0].isError).toBe(false);
    expect(turns[0].tools![0].completedAt).toBe('2025-01-01T00:00:01Z');
  });

  it('pairs multiple tools correctly', () => {
    const assistantRecord = makeAssistantRecord({
      message: {
        model: 'claude-sonnet-4-6',
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a.ts' } },
          { type: 'tool_use', id: 'tu-2', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'tu-3', name: 'Grep', input: { pattern: 'foo', path: '/src' } },
        ],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'contents of a.ts' },
          { type: 'tool_result', tool_use_id: 'tu-2', content: 'file1\nfile2' },
          { type: 'tool_result', tool_use_id: 'tu-3', content: 'match found' },
        ],
      },
    });

    builder.processAssistant(sessionId, assistantRecord);
    builder.processUser(sessionId, userRecord);

    const turns = getConversation();
    expect(turns).toHaveLength(1);
    expect(turns[0].tools).toHaveLength(3);
    expect(turns[0].tools![0].output).toBe('contents of a.ts');
    expect(turns[0].tools![1].output).toBe('file1\nfile2');
    expect(turns[0].tools![2].output).toBe('match found');
  });

  it('handles error tool results', () => {
    const assistantRecord = makeAssistantRecord({
      message: {
        model: 'claude-sonnet-4-6',
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'rm -rf /' } }],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'Permission denied',
            is_error: true,
          },
        ],
      },
    });

    builder.processAssistant(sessionId, assistantRecord);
    builder.processUser(sessionId, userRecord);

    const turns = getConversation();
    expect(turns[0].tools![0].isError).toBe(true);
    expect(turns[0].tools![0].output).toBe('Permission denied');
  });

  it('creates a user turn for text input', () => {
    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Please fix the bug in authentication.' }],
      },
    });

    builder.processUser(sessionId, userRecord);
    const turns = getConversation();

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].text).toBe('Please fix the bug in authentication.');
  });

  it('creates a system turn for turn_duration', () => {
    const record = makeSystemRecord({
      subtype: 'turn_duration',
      durationMs: 5432,
    });

    builder.processSystem(sessionId, record);
    const turns = getConversation();

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('system');
    expect(turns[0].systemEvent).toBe('turn_end');
    expect(turns[0].durationMs).toBe(5432);
  });

  it('ignores system records without turn_duration subtype', () => {
    const record = makeSystemRecord({});

    builder.processSystem(sessionId, record);
    const turns = getConversation();

    expect(turns).toHaveLength(0);
  });

  it('creates a system turn for summary records', () => {
    const record = makeSummaryRecord({
      summary: 'This session worked on authentication refactoring.',
    });

    builder.processSummary(sessionId, record);
    const turns = getConversation();

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('system');
    expect(turns[0].systemEvent).toBe('summary');
    expect(turns[0].summary).toBe('This session worked on authentication refactoring.');
  });

  it('extracts summary from message content array', () => {
    const record = makeSummaryRecord({
      message: {
        content: [
          { type: 'text', text: 'Summary part 1.' },
          { type: 'text', text: 'Summary part 2.' },
        ],
      },
    });

    builder.processSummary(sessionId, record);
    const turns = getConversation();

    expect(turns[0].summary).toBe('Summary part 1. Summary part 2.');
  });

  it('evicts oldest turns when exceeding MAX_CONVERSATION_TURNS_PER_SESSION', () => {
    for (let i = 0; i < MAX_CONVERSATION_TURNS_PER_SESSION + 10; i++) {
      builder.processUser(
        sessionId,
        makeUserRecord({
          timestamp: `2025-01-01T00:${String(i).padStart(2, '0')}:00Z`,
          message: {
            role: 'user',
            content: [{ type: 'text', text: `Message ${i}` }],
          },
        })
      );
    }

    const turns = getConversation();
    expect(turns).toHaveLength(MAX_CONVERSATION_TURNS_PER_SESSION);
    // First turn should be the 11th message (0-9 evicted)
    expect(turns[0].text).toBe('Message 10');
  });

  it('truncates long text at CONVERSATION_TEXT_MAX', () => {
    const longText = 'x'.repeat(TRUNCATION.CONVERSATION_TEXT_MAX + 100);
    builder.processUser(
      sessionId,
      makeUserRecord({
        message: {
          role: 'user',
          content: [{ type: 'text', text: longText }],
        },
      })
    );

    const turns = getConversation();
    expect(turns[0].text!.length).toBe(TRUNCATION.CONVERSATION_TEXT_MAX + 3); // +3 for '...'
    expect(turns[0].text!.endsWith('...')).toBe(true);
  });

  it('truncates tool input at TOOL_INPUT_MAX', () => {
    const longInput = { data: 'x'.repeat(TRUNCATION.TOOL_INPUT_MAX + 100) };
    builder.processAssistant(
      sessionId,
      makeAssistantRecord({
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: longInput }],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })
    );

    const turns = getConversation();
    expect(turns[0].tools![0].inputJson.length).toBeLessThanOrEqual(TRUNCATION.TOOL_INPUT_MAX + 3);
  });

  it('truncates tool output at TOOL_OUTPUT_MAX', () => {
    const longOutput = 'y'.repeat(TRUNCATION.TOOL_OUTPUT_MAX + 100);
    builder.processAssistant(
      sessionId,
      makeAssistantRecord({
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo.ts' } },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })
    );
    builder.processUser(
      sessionId,
      makeUserRecord({
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: longOutput }],
        },
      })
    );

    const turns = getConversation();
    expect(turns[0].tools![0].output!.length).toBeLessThanOrEqual(TRUNCATION.TOOL_OUTPUT_MAX + 3);
  });

  it('clears session data', () => {
    builder.processUser(
      sessionId,
      makeUserRecord({
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      })
    );

    expect(getConversation()).toHaveLength(1);

    builder.clearSession(sessionId);
    expect(getConversation()).toHaveLength(0);
  });

  it('returns only focused session + children for filtered conversation', () => {
    const parentId = 'parent-1';
    const childId = 'child-1';
    const unrelatedId = 'unrelated-1';

    builder.processUser(
      parentId,
      makeUserRecord({
        timestamp: '2025-01-01T00:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Parent msg' }] },
      })
    );
    builder.processUser(
      childId,
      makeUserRecord({
        timestamp: '2025-01-01T00:00:01Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Child msg' }] },
      })
    );
    builder.processUser(
      unrelatedId,
      makeUserRecord({
        timestamp: '2025-01-01T00:00:02Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Unrelated msg' }] },
      })
    );

    const sessions = new Map<string, { parentSessionId?: string; isSubAgent: boolean }>([
      [parentId, { isSubAgent: false }],
      [childId, { isSubAgent: true, parentSessionId: parentId }],
      [unrelatedId, { isSubAgent: false }],
    ]);

    const turns = builder.getFilteredConversation(parentId, sessions);

    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe('Parent msg');
    expect(turns[1].text).toBe('Child msg');
  });

  it('detects sub-agent spawning via Task tool', () => {
    builder.processAssistant(
      sessionId,
      makeAssistantRecord({
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'Task',
              input: { description: 'Explore the codebase', prompt: 'Find all tests' },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })
    );

    const turns = getConversation();
    expect(turns[0].subAgentDescription).toBe('Explore the codebase');
  });

  it('leaves output undefined for pending tool calls with no result', () => {
    builder.processAssistant(
      sessionId,
      makeAssistantRecord({
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo.ts' } },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })
    );

    const turns = getConversation();
    expect(turns[0].tools![0].output).toBeUndefined();
    expect(turns[0].tools![0].completedAt).toBeUndefined();
  });

  it('does not create user turn when only tool results and no text', () => {
    builder.processAssistant(
      sessionId,
      makeAssistantRecord({
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/foo.ts' } },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })
    );

    builder.processUser(
      sessionId,
      makeUserRecord({
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'file contents' }],
        },
      })
    );

    const turns = getConversation();
    // Only the assistant turn — no separate user turn for tool results alone
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
  });

  it('handles tool_result with array content', () => {
    builder.processAssistant(
      sessionId,
      makeAssistantRecord({
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'echo hi' } }],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      })
    );

    builder.processUser(
      sessionId,
      makeUserRecord({
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-1',
              content: [
                { type: 'text', text: 'line 1' },
                { type: 'text', text: 'line 2' },
              ],
            },
          ],
        },
      })
    );

    const turns = getConversation();
    expect(turns[0].tools![0].output).toBe('line 1\nline 2');
  });

  it('returns empty array when no session is focused', () => {
    builder.processUser(
      sessionId,
      makeUserRecord({
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      })
    );

    const turns = builder.getFilteredConversation(null, new Map());
    expect(turns).toHaveLength(0);
  });

  it('creates a user turn when content is a plain string', () => {
    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: 'Help me fix the login bug',
      },
    });

    builder.processUser(sessionId, userRecord);
    const turns = getConversation();

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].text).toBe('Help me fix the login bug');
  });

  it('does not create user turn for empty string content', () => {
    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: '',
      },
    });

    builder.processUser(sessionId, userRecord);
    const turns = getConversation();

    expect(turns).toHaveLength(0);
  });

  it('does not create user turn for whitespace-only string content', () => {
    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: '   ',
      },
    });

    builder.processUser(sessionId, userRecord);
    const turns = getConversation();

    expect(turns).toHaveLength(0);
  });

  it('does not create user turn for undefined content', () => {
    const userRecord = makeUserRecord({
      message: {
        role: 'user',
        content: undefined as unknown as string,
      },
    });

    builder.processUser(sessionId, userRecord);
    const turns = getConversation();

    expect(turns).toHaveLength(0);
  });

  it('disposes all state', () => {
    builder.processUser(
      sessionId,
      makeUserRecord({
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      })
    );

    builder.dispose();
    expect(getConversation()).toHaveLength(0);
  });
});
