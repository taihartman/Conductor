import React, { useState } from 'react';
import type { ToolInteraction } from '@shared/types';
import { COLORS, SIZES } from '../config/colors';
import { UI_STRINGS } from '../config/strings';
import { CodeBlock } from './CodeBlock';


interface ToolBlockProps {
  tool: ToolInteraction;
}

function getStatusIndicator(tool: ToolInteraction): { color: string; label: string } {
  if (tool.completedAt === undefined) {
    return { color: COLORS.TOOL_BLOCK_PENDING_INDICATOR, label: UI_STRINGS.TOOL_BLOCK_PENDING };
  }
  if (tool.isError) {
    return { color: COLORS.TOOL_BLOCK_ERROR_INDICATOR, label: UI_STRINGS.TOOL_BLOCK_ERROR };
  }
  return { color: COLORS.TOOL_BLOCK_SUCCESS_INDICATOR, label: UI_STRINGS.TOOL_BLOCK_SUCCESS };
}

export function ToolBlock({ tool }: ToolBlockProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const status = getStatusIndicator(tool);

  return (
    <div
      style={{
        borderRadius: '4px', // inline-ok
        backgroundColor: COLORS.TOOL_BLOCK_BG,
        overflow: 'hidden',
        marginBottom: '4px', // inline-ok
      }}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-sm)',
          width: '100%',
          padding: '4px 8px', // inline-ok
          fontSize: '12px', // inline-ok
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-secondary)',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        title={expanded ? UI_STRINGS.TOOL_BLOCK_COLLAPSE : UI_STRINGS.TOOL_BLOCK_EXPAND}
      >
        <span style={{ fontSize: '10px', transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : undefined /* inline-ok */ }}>
          {'\u25B6'}
        </span>

        <span
          style={{
            display: 'inline-block',
            padding: '0 4px', // inline-ok
            borderRadius: '3px', // inline-ok
            backgroundColor: COLORS.TOOL_BADGE_BG,
            color: 'var(--accent)',
            fontSize: '11px', // inline-ok
            whiteSpace: 'nowrap',
          }}
        >
          {tool.toolName}
        </span>

        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--fg-muted)',
            fontSize: '11px', // inline-ok
          }}
        >
          {tool.inputSummary}
        </span>

        <span
          style={{
            width: '6px', // inline-ok
            height: '6px', // inline-ok
            borderRadius: '50%',
            backgroundColor: status.color,
            flexShrink: 0,
          }}
          title={status.label}
        />
      </button>

      {/* Body — expanded */}
      {expanded && (
        <div
          style={{
            padding: '6px 8px', // inline-ok
            borderTop: '1px solid var(--border)',
            fontSize: '11px', // inline-ok
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.4,
          }}
        >
          {tool.inputJson && (
            <div style={{ marginBottom: '6px' /* inline-ok */ }}>
              <div style={{ color: 'var(--fg-muted)', marginBottom: '2px', fontSize: '10px' /* inline-ok */ }}>
                {UI_STRINGS.TOOL_BLOCK_INPUT_LABEL}
              </div>
              <CodeBlock maxHeight={SIZES.TOOL_INPUT_MAX_HEIGHT}>
                {formatJson(tool.inputJson)}
              </CodeBlock>
            </div>
          )}

          {tool.output !== undefined && (
            <div>
              <div
                style={{
                  color: tool.isError ? 'var(--status-error)' : 'var(--fg-muted)',
                  marginBottom: '2px', // inline-ok
                  fontSize: '10px', // inline-ok
                }}
              >
                {tool.isError ? UI_STRINGS.TOOL_BLOCK_ERROR_OUTPUT_LABEL : UI_STRINGS.TOOL_BLOCK_OUTPUT_LABEL}
              </div>
              {tool.isError ? (
                <pre
                  style={{
                    margin: 0,
                    padding: '4px 6px', // inline-ok
                    backgroundColor: COLORS.ERROR_ROW_BG,
                    borderRadius: '3px', // inline-ok
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--status-error)',
                    maxHeight: SIZES.TOOL_OUTPUT_MAX_HEIGHT,
                    overflowY: 'auto',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px', // inline-ok
                  }}
                >
                  {tool.output}
                </pre>
              ) : (
                <CodeBlock maxHeight={SIZES.TOOL_OUTPUT_MAX_HEIGHT}>
                  {tool.output}
                </CodeBlock>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(jsonStr: string): string {
  try {
    const parsed = JSON.parse(jsonStr);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return jsonStr;
  }
}
