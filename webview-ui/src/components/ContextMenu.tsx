import React, { useEffect, useRef } from 'react';
import { COLORS } from '../config/colors';

export interface ContextMenuItem {
  label: string;
  action: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

const MENU_WIDTH = 140; // inline-ok
const MENU_ITEM_HEIGHT = 32; // inline-ok
const EDGE_PADDING = 8; // inline-ok

export function ContextMenu({ items, position, onClose }: ContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  const menuHeight = items.length * MENU_ITEM_HEIGHT + EDGE_PADDING * 2;
  const x = Math.min(position.x, window.innerWidth - MENU_WIDTH - EDGE_PADDING);
  const y = Math.min(position.y, window.innerHeight - menuHeight - EDGE_PADDING);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: MENU_WIDTH,
        backgroundColor: COLORS.CONTEXT_MENU_BG,
        border: `1px solid ${COLORS.CONTEXT_MENU_BORDER}`,
        borderRadius: '4px', // inline-ok
        boxShadow: `0 4px 12px ${COLORS.CONTEXT_MENU_SHADOW}`, // inline-ok
        padding: `${EDGE_PADDING}px 0`, // inline-ok
        zIndex: 1000, // inline-ok
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            item.action();
            onClose();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = COLORS.CONTEXT_MENU_HOVER_BG;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 12px', // inline-ok
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-primary)',
            fontSize: '12px', // inline-ok
            fontFamily: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            lineHeight: `${MENU_ITEM_HEIGHT - 12}px`, // inline-ok
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
