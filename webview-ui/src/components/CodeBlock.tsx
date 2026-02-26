import React from 'react';
import { COLORS, SIZES } from '../config/colors';

interface CodeBlockProps {
  children: string;
  inline?: boolean;
  maxHeight?: string;
}

export const CodeBlock = React.memo(function CodeBlock({
  children,
  inline,
  maxHeight,
}: CodeBlockProps): React.ReactElement {
  if (inline) {
    return (
      <code
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9em', // inline-ok
          padding: '1px 4px', // inline-ok
          borderRadius: '3px', // inline-ok
          backgroundColor: COLORS.INLINE_CODE_BG,
        }}
      >
        {children}
      </code>
    );
  }

  return (
    <div style={{ maxHeight: maxHeight ?? SIZES.CODE_BLOCK_MAX_HEIGHT, overflow: 'auto', borderRadius: '3px' /* inline-ok */ }}>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px', // inline-ok
          backgroundColor: COLORS.CODE_BLOCK_BG,
          fontFamily: 'var(--font-mono)',
          fontSize: '12px', // inline-ok
          lineHeight: '1.5', // inline-ok
          color: 'var(--vscode-editor-foreground, #d4d4d4)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
});
