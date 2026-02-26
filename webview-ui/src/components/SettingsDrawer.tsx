import React, { useState, useRef } from 'react';
import { UI_STRINGS } from '../config/strings';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  autoHidePatterns: string[];
  onUpdatePatterns: (patterns: string[]) => void;
}

export function SettingsDrawer({
  open,
  onClose,
  autoHidePatterns,
  onUpdatePatterns,
}: SettingsDrawerProps): React.ReactElement | null {
  const [newPattern, setNewPattern] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function handleAdd(): void {
    const trimmed = newPattern.trim();
    if (trimmed && !autoHidePatterns.includes(trimmed)) {
      onUpdatePatterns([...autoHidePatterns, trimmed]);
      setNewPattern('');
      inputRef.current?.focus();
    }
  }

  function handleRemove(index: number): void {
    onUpdatePatterns(autoHidePatterns.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div
      style={{
        width: '300px', // inline-ok
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Drawer header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px var(--spacing-md)', // inline-ok
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '11px', // inline-ok
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--fg-secondary)',
          }}
        >
          {UI_STRINGS.SETTINGS_DRAWER_TITLE}
        </span>
        <button
          onClick={onClose}
          style={{
            padding: '2px 6px', // inline-ok
            fontSize: '11px', // inline-ok
            borderRadius: '3px',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label={UI_STRINGS.SETTINGS_CLOSE_LABEL}
        >
          ×
        </button>
      </div>

      {/* Drawer body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-md)' }}>
        {/* Auto-hide patterns section */}
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <h3
            style={{
              fontSize: '12px', // inline-ok
              fontWeight: 600,
              color: 'var(--fg-primary)',
              margin: '0 0 4px 0', // inline-ok
            }}
          >
            {UI_STRINGS.SETTINGS_AUTO_HIDE_HEADING}
          </h3>
          <p
            style={{
              fontSize: '11px', // inline-ok
              color: 'var(--fg-muted)',
              margin: '0 0 8px 0', // inline-ok
              lineHeight: 1.4,
            }}
          >
            {UI_STRINGS.SETTINGS_AUTO_HIDE_DESCRIPTION}
          </p>

          {/* Pattern list */}
          {autoHidePatterns.length === 0 ? (
            <p
              style={{
                fontSize: '11px', // inline-ok
                color: 'var(--fg-muted)',
                fontStyle: 'italic',
                margin: '0 0 8px 0', // inline-ok
              }}
            >
              {UI_STRINGS.SETTINGS_AUTO_HIDE_EMPTY}
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0 0 8px 0', // inline-ok
              }}
            >
              {autoHidePatterns.map((pattern, index) => (
                <li
                  key={`${pattern}-${index}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 6px', // inline-ok
                    fontSize: '11px', // inline-ok
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--fg-primary)',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)' /* inline-ok */,
                    marginBottom: '2px', // inline-ok
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pattern}
                  </span>
                  <button
                    onClick={() => handleRemove(index)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--fg-muted)',
                      cursor: 'pointer',
                      fontSize: '12px', // inline-ok
                      padding: '0 2px', // inline-ok
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-label={`Remove pattern "${pattern}"`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add pattern input */}
          <div style={{ display: 'flex', gap: '4px' /* inline-ok */ }}>
            <input
              ref={inputRef}
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={UI_STRINGS.SETTINGS_AUTO_HIDE_PLACEHOLDER}
              style={{
                flex: 1,
                padding: '3px 6px', // inline-ok
                fontSize: '11px', // inline-ok
                fontFamily: 'var(--font-mono)',
                borderRadius: '3px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--fg-primary)',
                outline: 'none',
              }}
            />
            <button
              onClick={handleAdd}
              disabled={!newPattern.trim()}
              style={{
                padding: '3px 8px', // inline-ok
                fontSize: '11px', // inline-ok
                borderRadius: '3px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-card)',
                color: newPattern.trim() ? 'var(--fg-secondary)' : 'var(--fg-muted)',
                cursor: newPattern.trim() ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
            >
              {UI_STRINGS.SETTINGS_AUTO_HIDE_ADD}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
