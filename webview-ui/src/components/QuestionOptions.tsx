import React, { useState } from 'react';
import type { PendingQuestionOption } from '@shared/types';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';

interface QuestionOptionsProps {
  options: PendingQuestionOption[];
  onSelect: (index: number) => void;
  disabled?: boolean;
}

// TODO: multiSelect not yet supported — buttons act as single-select

export function QuestionOptions({ options, onSelect, disabled }: QuestionOptionsProps): React.ReactElement {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div role="group" aria-label={UI_STRINGS.QUESTION_OPTIONS_LABEL} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {options.map((option, i) => {
        const index = i + 1; // 1-based to match terminal numbering
        const isHovered = hoveredIndex === i;
        return (
          <button
            key={i}
            onClick={() => {
              if (!disabled) onSelect(index);
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            disabled={disabled}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px', // inline-ok
              padding: '6px 8px', // inline-ok
              background: isHovered ? COLORS.QUESTION_OPTION_HOVER_BG : COLORS.QUESTION_OPTION_BG,
              border: `1px solid ${COLORS.QUESTION_OPTION_BORDER}`,
              borderRadius: '4px', // inline-ok
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              textAlign: 'left',
              width: '100%',
              transition: 'background-color 0.1s',
              color: 'inherit',
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px', // inline-ok
                height: '18px', // inline-ok
                borderRadius: '3px', // inline-ok
                background: COLORS.QUESTION_OPTION_BADGE_BG,
                fontSize: '10px', // inline-ok
                fontWeight: 700,
                flexShrink: 0,
                color: 'var(--fg-primary)',
              }}
            >
              {index}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-primary)' }}>{/* inline-ok */}
                {option.label}
              </span>
              {option.description && (
                <span style={{ fontSize: '11px', color: 'var(--fg-secondary)', lineHeight: 1.3 }}>{/* inline-ok */}
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
