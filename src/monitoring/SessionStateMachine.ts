/**
 * @module SessionStateMachine
 *
 * Six-state machine for a single Claude Code session.
 * Owns status transitions, intermission timer, error tracking, and stop reason.
 *
 * @remarks
 * States: working, thinking, waiting, error, idle, done.
 * Extracted from {@link SessionTracker} as part of Phase 2 decomposition.
 */

import {
  SessionStatus,
  AssistantRecord,
  UserRecord,
  SystemRecord,
  ProgressRecord,
  ToolUseContentBlock,
  ToolResultContentBlock,
  TextContentBlock,
} from '../models/types';

/**
 * Interface for the session state machine.
 * Handles status transitions based on incoming JSONL records.
 */
export interface ISessionStateMachine {
  readonly status: SessionStatus;
  readonly lastStopReason: string | null;
  readonly lastAssistantTime: number;
  readonly pendingQuestion: string | undefined;
  readonly recentErrorCount: number;
  handleAssistantRecord(record: AssistantRecord): SessionStatus;
  handleUserRecord(record: UserRecord): SessionStatus;
  handleSystemRecord(record: SystemRecord): SessionStatus;
  handleProgressRecord(record: ProgressRecord): SessionStatus;
  setStatus(status: SessionStatus): void;
  dispose(): void;
}

/** Number of tool errors in the error window to trigger error state. */
const ERROR_THRESHOLD = 3;
/** Time window (ms) for counting recent errors. */
const ERROR_WINDOW_MS = 60_000;

interface ErrorEntry {
  timestamp: number;
  toolName: string;
}

/**
 * Six-state machine for a single session's status transitions.
 *
 * @remarks
 * Manages: current status, intermission timer, error tracking, stop reason.
 * Does NOT manage: session metadata, activity events, analytics.
 */
export class SessionStateMachine implements ISessionStateMachine {
  private _status: SessionStatus = 'idle';
  private _lastStopReason: string | null = null;
  private _lastAssistantTime = 0;
  private _pendingQuestion: string | undefined;
  private intermissionTimer?: ReturnType<typeof setTimeout>;
  private readonly recentErrors: ErrorEntry[] = [];
  private readonly onStateChanged: () => void;

  constructor(onStateChanged: () => void) {
    this.onStateChanged = onStateChanged;
  }

  get status(): SessionStatus {
    return this._status;
  }

  get lastStopReason(): string | null {
    return this._lastStopReason;
  }

  get lastAssistantTime(): number {
    return this._lastAssistantTime;
  }

  get pendingQuestion(): string | undefined {
    return this._pendingQuestion;
  }

  get recentErrorCount(): number {
    this.pruneOldErrors();
    return this.recentErrors.length;
  }

  setStatus(status: SessionStatus): void {
    this._status = status;
  }

  handleAssistantRecord(record: AssistantRecord): SessionStatus {
    const msg = record.message;
    if (!msg) return this._status;

    this.cancelTimers();

    let hasToolUse = false;
    let hasAskUser = false;
    let askUserQuestion: string | undefined;

    for (const block of msg.content || []) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        const toolBlock = block as ToolUseContentBlock;
        if (toolBlock.name === 'AskUserQuestion') {
          hasAskUser = true;
          const questions = toolBlock.input?.questions;
          if (Array.isArray(questions) && questions.length > 0) {
            askUserQuestion = String((questions[0] as Record<string, unknown>)?.question || '');
          } else if (typeof toolBlock.input?.question === 'string') {
            askUserQuestion = toolBlock.input.question;
          }
        }
      }
    }

    if (hasAskUser) {
      this._status = 'waiting';
      this._pendingQuestion = askUserQuestion;
    } else if (hasToolUse) {
      this._status = 'working';
      this._pendingQuestion = undefined;
    } else if (msg.stop_reason === 'end_turn') {
      // Text-only end_turn: Claude is done and waiting for user input
      this._pendingQuestion = undefined;
      this._status = 'waiting';
    } else {
      // Text-only, not end_turn: thinking
      if (this._status !== 'working' && this._status !== 'error') {
        this._status = 'thinking';
      }
      this._pendingQuestion = undefined;
    }

    this._lastAssistantTime = Date.now();
    this._lastStopReason = msg.stop_reason;

    return this._status;
  }

  handleUserRecord(record: UserRecord): SessionStatus {
    const msg = record.message;
    if (!msg) return this._status;

    this.cancelTimers();

    for (const block of msg.content || []) {
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultContentBlock;
        if (resultBlock.is_error) {
          this.recordError('unknown');
          if (this.recentErrorCount >= ERROR_THRESHOLD) {
            this._status = 'error';
          } else {
            this._status = 'working';
          }
        } else {
          // Non-error result clears error state
          if (this._status === 'error') {
            this.recentErrors.length = 0;
          }
          this._status = 'working';
        }
        this._pendingQuestion = undefined;
      } else if (block.type === 'text') {
        const textBlock = block as TextContentBlock;
        if (textBlock.text && textBlock.text.trim().length > 0) {
          // User text input resets error tracking
          this.recentErrors.length = 0;
          this._status = 'working';
          this._pendingQuestion = undefined;
        }
      }
    }

    return this._status;
  }

  handleSystemRecord(record: SystemRecord): SessionStatus {
    if (record.subtype === 'turn_duration') {
      this.cancelTimers();
      // Turn finished — Claude is waiting for the next user message
      this._status = 'waiting';
    }
    return this._status;
  }

  handleProgressRecord(_record: ProgressRecord): SessionStatus {
    this.cancelTimers();
    if (this._status !== 'working') {
      this._status = 'thinking';
    }
    return this._status;
  }

  dispose(): void {
    this.cancelTimers();
  }

  private cancelTimers(): void {
    if (this.intermissionTimer) {
      clearTimeout(this.intermissionTimer);
      this.intermissionTimer = undefined;
    }
  }

  private recordError(toolName: string): void {
    this.recentErrors.push({ timestamp: Date.now(), toolName });
    this.pruneOldErrors();
  }

  private pruneOldErrors(): void {
    const cutoff = Date.now() - ERROR_WINDOW_MS;
    while (this.recentErrors.length > 0 && this.recentErrors[0].timestamp < cutoff) {
      this.recentErrors.shift();
    }
  }
}
