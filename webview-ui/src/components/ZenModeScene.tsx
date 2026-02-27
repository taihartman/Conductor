import React, { useState, useEffect, useRef } from 'react';
import { ZenOwlblob } from './ZenOwlblob';
import { UI_STRINGS } from '../config/strings';
import { COLORS } from '../config/colors';

const ZEN_NOTE_LIFETIME_MS = 10_000;
const ZEN_NOTE_CLEANUP_INTERVAL_MS = 5_000;
const ZEN_MAX_COMPLETION_NOTES = 10;

interface CompletionNote {
  id: number;
  side: 'left' | 'right';
  x: number;
  y: number;
  createdAt: number;
}

interface ZenModeSceneProps {
  completionCount: number;
  onExit: () => void;
  /** When true, renders as a passive visual — no focus steal, no click handler, hidden from a11y tree. */
  decorative?: boolean;
}

const AMBIENT_NOTES = [
  { x: '15%', y: '70%', delay: '0s', char: '\u266B' },
  { x: '80%', y: '65%', delay: '3s', char: '\u266A' },
  { x: '25%', y: '80%', delay: '6s', char: '\u266A' },
  { x: '70%', y: '75%', delay: '9s', char: '\u266B' },
  { x: '50%', y: '85%', delay: '4.5s', char: '\u266A' },
];

let noteIdCounter = 0;

export function ZenModeScene({
  completionCount,
  onExit,
  decorative = false,
}: ZenModeSceneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(completionCount);
  const [completionNotes, setCompletionNotes] = useState<CompletionNote[]>([]);

  // Auto-focus only in interactive (full-screen) mode
  useEffect(() => {
    if (!decorative) {
      containerRef.current?.focus();
    }
  }, [decorative]);

  // Spawn completion notes when count increments
  useEffect(() => {
    if (completionCount > prevCountRef.current) {
      const newNotes = completionCount - prevCountRef.current;
      prevCountRef.current = completionCount;

      setCompletionNotes((prev) => {
        const additions: CompletionNote[] = [];
        for (let i = 0; i < newNotes; i++) {
          const side = Math.random() > 0.5 ? 'right' : 'left';
          additions.push({
            id: ++noteIdCounter,
            side,
            x: side === 'left' ? 10 + Math.random() * 20 : 70 + Math.random() * 20,
            y: 50 + Math.random() * 30,
            createdAt: Date.now(),
          });
        }
        return [...prev, ...additions].slice(-ZEN_MAX_COMPLETION_NOTES);
      });
    }
  }, [completionCount]);

  // Clean up expired completion notes
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setCompletionNotes((prev) =>
        prev.filter((n) => now - n.createdAt < ZEN_NOTE_LIFETIME_MS),
      );
    }, ZEN_NOTE_CLEANUP_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  return (
    <div
      ref={containerRef}
      className="zen-scene"
      {...(!decorative && {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': UI_STRINGS.ZEN_EXIT_LABEL,
        onClick: onExit,
      })}
      {...(decorative && { 'aria-hidden': true as const })}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(
          180deg,
          var(--zen-bg-start) 0%,
          var(--zen-bg-mid) 50%,
          var(--zen-bg-end) 100%
        )`,
        position: 'relative',
        overflow: 'hidden',
        outline: 'none',
        minHeight: 0,
      }}
    >
      {/* Ambient floating notes */}
      {AMBIENT_NOTES.map((note, i) => (
        <span
          key={i}
          className="zen-note-float"
          style={{
            position: 'absolute',
            left: note.x,
            top: note.y,
            fontSize: '20px', // inline-ok
            color: '#b8a0d8', // inline-ok
            opacity: 0.4,
            animationDelay: note.delay,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {note.char}
        </span>
      ))}

      {/* Completion notes */}
      {completionNotes.map((note) => (
        <span
          key={note.id}
          className={`zen-completion-note--${note.side}`}
          style={{
            position: 'absolute',
            left: `${note.x}%`,
            top: `${note.y}%`,
            fontSize: '24px', // inline-ok
            color: COLORS.ZEN_NOTE_BRIGHT,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {'\u266B'}
        </span>
      ))}

      {/* Centered mascot */}
      <ZenOwlblob size={180} />
    </div>
  );
}
