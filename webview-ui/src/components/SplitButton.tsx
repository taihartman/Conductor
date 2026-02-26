import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LAUNCH_MODES } from '@shared/sharedConstants';
import type { LaunchMode } from '@shared/sharedConstants';
import { UI_STRINGS } from '../config/strings';

interface SplitButtonProps {
  currentMode: LaunchMode;
  onLaunch: (mode: LaunchMode) => void;
  onModeChange: (mode: LaunchMode) => void;
  disabled?: boolean;
}

interface ModeOption {
  mode: LaunchMode;
  label: string;
  description?: string;
  disabled?: boolean;
  warning?: boolean;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: LAUNCH_MODES.NORMAL, label: UI_STRINGS.LAUNCH_MODE_NORMAL },
  {
    mode: LAUNCH_MODES.YOLO,
    label: UI_STRINGS.LAUNCH_MODE_YOLO,
    description: UI_STRINGS.YOLO_DROPDOWN_WARNING,
    warning: true,
  },
  {
    mode: LAUNCH_MODES.REMOTE,
    label: UI_STRINGS.LAUNCH_MODE_REMOTE_COMING_SOON,
    disabled: true,
  },
];

function getLabelForMode(mode: LaunchMode): string {
  switch (mode) {
    case LAUNCH_MODES.YOLO:
      return UI_STRINGS.LAUNCH_MODE_YOLO;
    case LAUNCH_MODES.REMOTE:
      return UI_STRINGS.LAUNCH_MODE_REMOTE;
    default:
      return UI_STRINGS.LAUNCH_MODE_NORMAL;
  }
}

export function SplitButton({
  currentMode,
  onLaunch,
  onModeChange,
  disabled,
}: SplitButtonProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1); // inline-ok
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;
      const enabledOptions = MODE_OPTIONS.filter((o) => !o.disabled);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % enabledOptions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + enabledOptions.length) % enabledOptions.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const selected = enabledOptions[focusedIndex];
          if (selected) {
            onModeChange(selected.mode);
            onLaunch(selected.mode);
            setIsOpen(false);
          }
          break;
        }
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [isOpen, focusedIndex, onLaunch, onModeChange]
  );

  const handleOptionClick = (option: ModeOption): void => {
    if (option.disabled) return;
    onModeChange(option.mode);
    onLaunch(option.mode);
    setIsOpen(false);
  };

  const isYolo = currentMode === LAUNCH_MODES.YOLO;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Primary action button */}
      <button
        onClick={() => onLaunch(currentMode)}
        disabled={disabled}
        style={{
          padding: '3px 10px', // inline-ok
          fontSize: '13px', // inline-ok
          fontWeight: 700,
          borderRadius: '3px 0 0 3px', // inline-ok
          border: '1px solid var(--border)',
          borderRight: 'none',
          backgroundColor: isYolo ? 'rgba(240, 173, 78, 0.15)' : 'var(--bg-card)', // inline-ok: mode-specific highlight
          color: disabled
            ? 'var(--fg-muted)'
            : isYolo
              ? 'var(--status-waiting)'
              : 'var(--fg-secondary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          opacity: disabled ? 0.5 : 1, // inline-ok
          whiteSpace: 'nowrap',
        }}
        title={
          disabled ? UI_STRINGS.NESTED_SESSION_TOOLTIP : UI_STRINGS.LAUNCH_SESSION_TOOLTIP
        }
        aria-label={getLabelForMode(currentMode)}
      >
        {getLabelForMode(currentMode)}
      </button>

      {/* Chevron dropdown trigger */}
      <button
        onClick={() => {
          setIsOpen((prev) => !prev);
          setFocusedIndex(-1); // inline-ok
        }}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={UI_STRINGS.SPLIT_BUTTON_CHEVRON_LABEL}
        style={{
          padding: '3px 6px', // inline-ok
          fontSize: '11px', // inline-ok
          fontWeight: 700,
          borderRadius: '0 3px 3px 0', // inline-ok
          border: '1px solid var(--border)',
          backgroundColor: isYolo ? 'rgba(240, 173, 78, 0.15)' : 'var(--bg-card)', // inline-ok: mode-specific highlight
          color: disabled ? 'var(--fg-muted)' : 'var(--fg-secondary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          opacity: disabled ? 0.5 : 1, // inline-ok
        }}
        onKeyDown={handleKeyDown}
      >
        {'\u25BE'}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={UI_STRINGS.SPLIT_BUTTON_DROPDOWN_LABEL}
          onKeyDown={handleKeyDown}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '2px', // inline-ok
            minWidth: '200px', // inline-ok
            borderRadius: '3px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-card)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)', // inline-ok
            zIndex: 100, // inline-ok
            overflow: 'hidden',
          }}
        >
          {MODE_OPTIONS.map((option) => {
            const enabledOptions = MODE_OPTIONS.filter((o) => !o.disabled);
            const enabledIndex = enabledOptions.indexOf(option);
            const isFocused = enabledIndex === focusedIndex;
            const isActive = option.mode === currentMode;

            return (
              <div
                key={option.mode}
                role="menuitem"
                tabIndex={option.disabled ? -1 : 0} // inline-ok
                aria-disabled={option.disabled}
                onClick={() => handleOptionClick(option)}
                onMouseEnter={() => {
                  if (!option.disabled) setFocusedIndex(enabledIndex);
                }}
                style={{
                  padding: '6px 12px', // inline-ok
                  fontSize: '12px', // inline-ok
                  cursor: option.disabled ? 'default' : 'pointer',
                  color: option.disabled
                    ? 'var(--fg-muted)'
                    : option.warning
                      ? 'var(--status-waiting)'
                      : 'var(--fg-primary)',
                  backgroundColor: isFocused ? 'rgba(255, 255, 255, 0.08)' : 'transparent', // inline-ok
                  opacity: option.disabled ? 0.5 : 1, // inline-ok
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px', // inline-ok
                  fontFamily: 'inherit',
                  borderLeft: isActive
                    ? '2px solid var(--accent)'
                    : '2px solid transparent', // inline-ok
                }}
              >
                <span style={{ fontWeight: isActive ? 600 : 400 }}>{option.label}</span>
                {option.description && (
                  <span
                    style={{
                      fontSize: '10px', // inline-ok
                      color: 'var(--fg-muted)',
                    }}
                  >
                    {option.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
