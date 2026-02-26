import React from 'react';
import { SyntaxHighlighter } from '../config/highlightSetup';
import { vsCodeSyntaxTheme } from '../config/syntaxTheme';
import { COLORS, SIZES } from '../config/colors';

interface CodeBlockProps {
  children: string;
  language?: string;
  inline?: boolean;
  maxHeight?: string;
}

export const CodeBlock = React.memo(function CodeBlock({
  children,
  language,
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
      <SyntaxHighlighter
        language={language ?? 'text'}
        style={vsCodeSyntaxTheme}
        wrapLongLines
        customStyle={{ margin: 0 }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
});
