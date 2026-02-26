import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock';

interface MarkdownContentProps {
  content: string;
}

const components: Components = {
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, '');

    // react-markdown passes inline code without a className
    const isInline = !className && !('node' in props && props.node?.position?.start.line !== props.node?.position?.end.line);

    if (isInline) {
      return <CodeBlock inline>{text}</CodeBlock>;
    }
    return <CodeBlock>{text}</CodeBlock>;
  },
  a({ children, href }) {
    return (
      <span className="markdown-content-link" title={href}>
        {children}
      </span>
    );
  },
  table({ children }) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table>{children}</table>
      </div>
    );
  },
};

export const MarkdownContent = React.memo(function MarkdownContent({
  content,
}: MarkdownContentProps): React.ReactElement {
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
