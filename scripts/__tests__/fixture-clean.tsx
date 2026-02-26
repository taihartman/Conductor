import React from 'react';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';

// A comment mentioning rgba(255,0,0) should not trigger
// Colors in SVG: fill="#fff" stroke="#000" should not trigger

export const CleanComponent: React.FC = () => {
  const items = [1, 2, 3];
  return (
    <div
      style={{
        backgroundColor: COLORS.ERROR_ROW_BG,
        padding: 'var(--spacing-md)',
        width: 'var(--button-width)',
        opacity: 0.5,
      }}
      title={UI_STRINGS.REFRESH_BUTTON}
    >
      <span>{UI_STRINGS.LIVE_FEED_EMPTY}</span>
      <svg>
        <path fill="#fff" stroke="#000" d="M0 0" />
      </svg>
      {items.slice(0, 5).map((x) => (
        <span key={x}>{x}</span>
      ))}
      {items.length > 50 && <span>Many items</span>}
    </div>
  );
};
