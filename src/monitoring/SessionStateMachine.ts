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

  /**
   * Current session status.
   *
   * @returns The current {@link SessionStatus}
   */
  get status(): SessionStatus {
    return this._status;
  }

  /**
   * The `stop_reason` from the most recent assistant message.
   *
   * @returns The stop reason string, or `null` if no assistant message has been processed
   */
  get lastStopReason(): string | null {
    return this._lastStopReason;
  }

  /**
   * Timestamp (ms since epoch) of the last assistant message.
   *
   * @returns Milliseconds since epoch, or `0` if no assistant message has been processed
   */
  get lastAssistantTime(): number {
    return this._lastAssistantTime;
  }

  /**
   * The question text if Claude is waiting for user input via AskUserQuestion.
   *
   * @returns The question string, or `undefined` if not waiting
   */
  get pendingQuestion(): string | undefined {
    return this._pendingQuestion;
  }

  /**
   * Number of tool errors in the recent time window.
   *
   * @returns Count of errors within the last {@link ERROR_WINDOW_MS} milliseconds
   */
  get recentErrorCount(): number {
    this.pruneOldErrors();
    return this.recentErrors.length;
  }

  /**
   * Force the session to a specific status (e.g., for idle timeout).
   *
   * @param status - The new session status
   */
  setStatus(status: SessionStatus): void {
    this._status = status;
  }

  /**
   * Process an assistant record and return the updated status.
   *
   * @param record - The assistant JSONL record
   * @returns The new session status after processing
   */
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
      // Text-only end_turn: Claude finished its turn
      this._pendingQuestion = undefined;
      this._status = 'done';
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

  /**
   * Process a user record and return the updated status.
   *
   * @param record - The user JSONL record
   * @returns The new session status after processing
   */
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

  /**
   * Process a system record and return the updated status.
   *
   * @param record - The system JSONL record
   * @returns The new session status after processing
   */
  handleSystemRecord(record: SystemRecord): SessionStatus {
    if (record.subtype === 'turn_duration') {
      this.cancelTimers();
      // Turn finished — only mark done if not already waiting for AskUserQuestion
      if (this._status !== 'waiting') {
        this._status = 'done';
      }
    }
    return this._status;
  }

  /**
   * Process a progress record and return the updated status.
   *
   * @param _record - The progress JSONL record
   * @returns The new session status after processing
   */
  handleProgressRecord(_record: ProgressRecord): SessionStatus {
    this.cancelTimers();
    if (this._status !== 'working') {
      this._status = 'thinking';
    }
    return this._status;
  }

  /** Cancel all pending timers and release resources. */
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
