import React, { useState, useRef, useCallback } from 'react';
import type { SessionInfo } from '@shared/types';
import { SESSION_STATUSES, TOOL_APPROVAL_INPUTS, PLAN_INPUTS } from '@shared/sharedConstants';
import { vscode } from '../vscode';
import { useDashboardStore } from '../store/dashboardStore';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';
import { QuestionOptions } from './QuestionOptions';

interface ChatInputProps {
  sessionId: string;
  session: SessionInfo;
  /** Sub-agent session whose pendingQuestion should be surfaced (if any). */
  subAgentSession?: SessionInfo;
}

export function ChatInput({ sessionId, session, subAgentSession }: ChatInputProps): React.ReactElement {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastInputStatus = useDashboardStore((s) => s.lastInputStatus);

  const canSend = text.trim().length > 0 && !sending;

  const send = useCallback(() => {
    if (!canSend) return;
    setSending(true);
    vscode.postMessage({ type: 'user:send-input', sessionId, text: text.trim() });
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [canSend, sessionId, text]);

  // Clear sending state when we get feedback (but not on 'adopting' — terminal is still opening)
  React.useEffect(() => {
    if (lastInputStatus && lastInputStatus.sessionId === sessionId && lastInputStatus.status !== 'adopting') {
      setSending(false);
    }
  }, [lastInputStatus, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-grow textarea
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }, []);

  const handleOptionSelect = useCallback(
    (index: number) => {
      if (sending) return;
      setSending(true);
      vscode.postMessage({ type: 'user:send-input', sessionId, text: String(index) });
    },
    [sending, sessionId]
  );

  // Parent's own pendingQuestion takes priority; otherwise fall back to sub-agent's.
  const effectiveSession = session.pendingQuestion ? session : (subAgentSession ?? session);

  // Status feedback text — adopting check first since sending is still true during adoption
  const feedbackText = (() => {
    if (lastInputStatus?.sessionId === sessionId && lastInputStatus.status === 'adopting') {
      return UI_STRINGS.CHAT_INPUT_ADOPTING;
    }
    if (sending) return '...';
    if (!lastInputStatus || lastInputStatus.sessionId !== sessionId) return null;
    switch (lastInputStatus.status) {
      case 'sent':
        return UI_STRINGS.CHAT_INPUT_SENT;
      case 'no-terminal':
        return UI_STRINGS.CHAT_INPUT_NO_TERMINAL;
      case 'error':
        return `${UI_STRINGS.CHAT_INPUT_ERROR}: ${lastInputStatus.error ?? ''}`;
      default:
        return null;
    }
  })();

  return (
    <div
      style={{
        borderTop: `1px solid ${COLORS.CHAT_INPUT_BORDER}`,
        background: COLORS.CHAT_INPUT_BG,
        padding: '8px 12px', // inline-ok
        flexShrink: 0,
      }}
    >
      {/* AskUserQuestion — shows question text + clickable option buttons */}
      {effectiveSession.status === SESSION_STATUSES.WAITING && effectiveSession.pendingQuestion &&
       !effectiveSession.pendingQuestion.isPlanApproval && !effectiveSession.pendingQuestion.isToolApproval && (
        <div style={{ marginBottom: '6px' /* inline-ok */ }}>
          {effectiveSession.pendingQuestion.header && (
            <div style={{
              fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', // inline-ok
              letterSpacing: '0.5px', color: 'var(--fg-muted)', marginBottom: '4px', // inline-ok
            }}>
              {effectiveSession.pendingQuestion.header}
            </div>
          )}
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', lineHeight: 1.4 /* inline-ok */ }}>
            <strong>{UI_STRINGS.CHAT_INPUT_WAITING_PREFIX}</strong> {effectiveSession.pendingQuestion.question}
          </div>
          {effectiveSession.pendingQuestion.options.length > 0 && (
            <>
              <QuestionOptions
                options={effectiveSession.pendingQuestion.options}
                onSelect={handleOptionSelect}
                disabled={sending}
              />
              <button
                onClick={() => textareaRef.current?.focus()}
                style={{
                  width: '100%',
                  padding: '6px 10px', // inline-ok
                  marginTop: '4px', // inline-ok
                  fontSize: '12px', // inline-ok
                  fontStyle: 'italic',
                  color: 'var(--fg-secondary)',
                  background: COLORS.QUESTION_OPTION_BG,
                  border: `1px dashed ${COLORS.QUESTION_OPTION_BORDER}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {UI_STRINGS.CHAT_INPUT_OTHER_OPTION}
              </button>
            </>
          )}
        </div>
      )}

      {/* EnterPlanMode — Yes/No buttons */}
      {effectiveSession.status === SESSION_STATUSES.WAITING &&
       effectiveSession.pendingQuestion?.isPlanApproval &&
       effectiveSession.pendingQuestion.planMode === 'enter' && (
        <div style={{ marginBottom: '6px' /* inline-ok */ }}>
          <div style={{
            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', // inline-ok
            letterSpacing: '0.5px', color: 'var(--status-waiting)', marginBottom: '4px', // inline-ok
          }}>
            {UI_STRINGS.CHAT_INPUT_ENTER_PLAN_PREFIX}
          </div>
          <div style={{
            fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '6px', // inline-ok
            fontStyle: 'italic',
          }}>
            {UI_STRINGS.CHAT_INPUT_ENTER_PLAN_HINT}
          </div>
          <div style={{ display: 'flex', gap: '6px' /* inline-ok */ }}>
            <button
              onClick={() => {
                setSending(true);
                vscode.postMessage({ type: 'user:send-input', sessionId, text: PLAN_INPUTS.YES });
              }}
              disabled={sending}
              style={{
                padding: '4px 12px', // inline-ok
                fontSize: '11px', // inline-ok
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                cursor: sending ? 'default' : 'pointer',
                background: 'var(--accent, #007acc)', // inline-ok: CSS var with fallback
                color: '#fff', // inline-ok: button text color
                opacity: sending ? 0.5 : 1, // inline-ok
              }}
            >
              {UI_STRINGS.CHAT_INPUT_ENTER_PLAN_YES}
            </button>
            <button
              onClick={() => {
                setSending(true);
                vscode.postMessage({ type: 'user:send-input', sessionId, text: PLAN_INPUTS.NO });
              }}
              disabled={sending}
              style={{
                padding: '4px 12px', // inline-ok
                fontSize: '11px', // inline-ok
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                cursor: sending ? 'default' : 'pointer',
                background: COLORS.TOOL_ALLOW_ALWAYS_BUTTON_BG,
                color: 'var(--fg-primary)',
                opacity: sending ? 0.5 : 1, // inline-ok
              }}
            >
              {UI_STRINGS.CHAT_INPUT_ENTER_PLAN_NO}
            </button>
          </div>
        </div>
      )}

      {/* ExitPlanMode — approve button + feedback textarea (also handles undefined planMode for backward compat) */}
      {effectiveSession.status === SESSION_STATUSES.WAITING &&
       effectiveSession.pendingQuestion?.isPlanApproval &&
       effectiveSession.pendingQuestion.planMode !== 'enter' && (
        <div style={{ marginBottom: '6px' /* inline-ok */ }}>
          <div style={{
            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', // inline-ok
            letterSpacing: '0.5px', color: 'var(--status-waiting)', marginBottom: '4px', // inline-ok
          }}>
            {UI_STRINGS.CHAT_INPUT_PLAN_APPROVAL_PREFIX}
          </div>
          <div style={{
            fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '6px', // inline-ok
            fontStyle: 'italic',
          }}>
            {UI_STRINGS.CHAT_INPUT_PLAN_APPROVAL_HINT}
          </div>
          <button
            onClick={() => {
              setSending(true);
              vscode.postMessage({ type: 'user:send-input', sessionId, text: PLAN_INPUTS.YES });
            }}
            disabled={sending}
            style={{
              padding: '4px 12px', // inline-ok
              fontSize: '11px', // inline-ok
              fontWeight: 600,
              borderRadius: '4px',
              border: 'none',
              cursor: sending ? 'default' : 'pointer',
              background: 'var(--accent, #007acc)', // inline-ok: CSS var with fallback
              color: '#fff', // inline-ok: button text color
              opacity: sending ? 0.5 : 1, // inline-ok
            }}
          >
            {UI_STRINGS.CHAT_INPUT_PLAN_APPROVE_BUTTON}
          </button>
        </div>
      )}

      {/* Tool approval — pending tools + Allow/Always/Deny buttons */}
      {effectiveSession.status === SESSION_STATUSES.WAITING && effectiveSession.pendingQuestion?.isToolApproval && (
        <div style={{ marginBottom: '6px' /* inline-ok */ }}>
          <div style={{
            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', // inline-ok
            letterSpacing: '0.5px', color: 'var(--status-waiting)', marginBottom: '4px', // inline-ok
          }}>
            {UI_STRINGS.CHAT_INPUT_TOOL_APPROVAL_PREFIX}
          </div>
          {effectiveSession.pendingQuestion.pendingTools?.map((tool, i) => (
            <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' /* inline-ok */ }}>
              <strong>{tool.toolName}</strong>
              {tool.inputSummary && (
                <span style={{ color: 'var(--fg-secondary)' }}> — {tool.inputSummary}</span>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' /* inline-ok */ }}>
            <button
              onClick={() => {
                setSending(true);
                vscode.postMessage({ type: 'user:send-input', sessionId, text: TOOL_APPROVAL_INPUTS.ALLOW });
              }}
              disabled={sending}
              style={{
                padding: '4px 12px', // inline-ok
                fontSize: '11px', // inline-ok
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                cursor: sending ? 'default' : 'pointer',
                background: 'var(--accent, #007acc)', // inline-ok: CSS var with fallback
                color: '#fff', // inline-ok: button text color
                opacity: sending ? 0.5 : 1, // inline-ok
              }}
            >
              {UI_STRINGS.CHAT_INPUT_TOOL_ALLOW}
            </button>
            <button
              onClick={() => {
                setSending(true);
                vscode.postMessage({ type: 'user:send-input', sessionId, text: TOOL_APPROVAL_INPUTS.ALLOW_ALWAYS });
              }}
              disabled={sending}
              style={{
                padding: '4px 12px', // inline-ok
                fontSize: '11px', // inline-ok
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                cursor: sending ? 'default' : 'pointer',
                background: COLORS.TOOL_ALLOW_ALWAYS_BUTTON_BG,
                color: 'var(--fg-primary)',
                opacity: sending ? 0.5 : 1, // inline-ok
              }}
            >
              {UI_STRINGS.CHAT_INPUT_TOOL_ALLOW_ALWAYS}
            </button>
            <button
              onClick={() => {
                setSending(true);
                vscode.postMessage({ type: 'user:send-input', sessionId, text: TOOL_APPROVAL_INPUTS.DENY });
              }}
              disabled={sending}
              style={{
                padding: '4px 12px', // inline-ok
                fontSize: '11px', // inline-ok
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                cursor: sending ? 'default' : 'pointer',
                background: COLORS.TOOL_DENY_BUTTON_BG,
                color: 'var(--fg-primary)',
                opacity: sending ? 0.5 : 1, // inline-ok
              }}
            >
              {UI_STRINGS.CHAT_INPUT_TOOL_DENY}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={UI_STRINGS.CHAT_INPUT_PLACEHOLDER}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            background: 'var(--input-bg, rgba(0, 0, 0, 0.2))', // inline-ok: CSS var with fallback
            border: `1px solid ${COLORS.CHAT_INPUT_BORDER}`,
            borderRadius: '4px',
            color: 'var(--text-primary)',
            padding: '6px 8px',
            fontSize: '13px', // inline-ok
            fontFamily: 'inherit',
            lineHeight: 1.4,
            outline: 'none',
            overflow: 'hidden',
          }}
        />
        <button
          onClick={send}
          disabled={!canSend}
          style={{
            padding: '6px 12px', // inline-ok
            fontSize: '12px', // inline-ok
            fontWeight: 600,
            borderRadius: '4px',
            border: 'none',
            cursor: canSend ? 'pointer' : 'default',
            background: canSend ? 'var(--accent, #007acc)' : 'rgba(255, 255, 255, 0.05)', // inline-ok: CSS var with fallback
            color: canSend ? '#fff' : 'var(--text-secondary)', // inline-ok: button text color
            opacity: canSend ? 1 : 0.5,
            flexShrink: 0,
          }}
        >
          {UI_STRINGS.CHAT_INPUT_SEND}
        </button>
      </div>

      {feedbackText && (
        <div
          style={{
            fontSize: '11px', // inline-ok
            color: 'var(--text-secondary)',
            marginTop: '4px',
          }}
        >
          {feedbackText}
        </div>
      )}
    </div>
  );
}
