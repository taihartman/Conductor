import React, { useState } from 'react';

interface AccordionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function Accordion({ title, children, defaultOpen = false }: AccordionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: '2px' /* inline-ok */ }}>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px', // inline-ok
          width: '100%',
          padding: '4px 0', // inline-ok
          fontSize: '11px', // inline-ok
          fontFamily: 'inherit',
          color: 'var(--fg-primary)',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontSize: '8px', // inline-ok
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : undefined,
            flexShrink: 0,
          }}
        >
          {'\u25B6'}
        </span>
        <span style={{ fontWeight: 600 }}>{title}</span>
      </button>

      {expanded && (
        <div
          style={{
            paddingLeft: '14px', // inline-ok
            paddingBottom: '4px', // inline-ok
            fontSize: '11px', // inline-ok
            color: 'var(--fg-muted)',
            lineHeight: 1.4,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
