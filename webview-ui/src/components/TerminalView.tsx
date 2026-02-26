/**
 * Embedded xterm.js terminal for Conductor-launched sessions.
 *
 * @remarks
 * Receives PTY data via `pty:data` IPC messages from the extension and sends
 * keystrokes back via `pty:input`. Handles resize via `pty:resize` using the
 * xterm-addon-fit addon.
 *
 * On mount (or remount after toggle), replays buffered data from the PtyBridge
 * ring buffer so the terminal shows recent output immediately.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { vscode } from '../vscode';
import { useDashboardStore } from '../store/dashboardStore';
import { UI_STRINGS } from '../config/strings';

interface TerminalViewProps {
  sessionId: string;
}

/** Delay before showing the no-PTY-data placeholder (ms). */
const NO_PTY_DATA_DELAY_MS = 1500; // inline-ok: one-off timing constant

export function TerminalView({ sessionId }: TerminalViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyBuffer = useDashboardStore((s) => s.ptyBuffers.get(sessionId) ?? '');
  const [showPlaceholder, setShowPlaceholder] = useState(false);

  // Show placeholder after a delay if no PTY data arrives
  useEffect(() => {
    if (ptyBuffer) {
      setShowPlaceholder(false);
      return;
    }
    const timer = setTimeout(() => setShowPlaceholder(true), NO_PTY_DATA_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ptyBuffer]);

  // Initialize terminal on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      fontSize: 13, // inline-ok: terminal font size
      fontFamily: 'var(--vscode-editor-font-family, "Menlo", "Monaco", "Courier New", monospace)',
      theme: {
        background: '#1e1e1e', // inline-ok: terminal background matching VS Code dark theme
        foreground: '#cccccc', // inline-ok: terminal foreground
        cursor: '#ffffff', // inline-ok: terminal cursor
        selectionBackground: 'rgba(255, 255, 255, 0.3)', // inline-ok: terminal selection
      },
      cursorBlink: true,
      scrollback: 5000, // inline-ok: reasonable scrollback
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Fit after opening
    try {
      fitAddon.fit();
    } catch {
      // Container might not have dimensions yet
    }

    // Send keystrokes to extension
    terminal.onData((data) => {
      vscode.postMessage({ type: 'pty:input', sessionId, data });
    });

    // Send resize events to extension
    terminal.onResize(({ cols, rows }) => {
      vscode.postMessage({ type: 'pty:resize', sessionId, cols, rows });
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Replay buffered data if available
    if (ptyBuffer) {
      terminal.write(ptyBuffer);
    }

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during layout transitions
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // Only re-init when sessionId changes, not on every ptyBuffer update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Listen for pty:data messages and write to terminal
  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      const msg = event.data;
      if (msg.type === 'pty:data' && msg.sessionId === sessionId) {
        terminalRef.current?.write(msg.data);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId]);

  // Focus terminal on click
  const handleClick = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        onClick={handleClick}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      />
      {showPlaceholder && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(30, 30, 30, 0.85)', // inline-ok: overlay backdrop
            color: 'var(--fg-secondary)',
            fontSize: '13px', // inline-ok: placeholder text size
            padding: 'var(--spacing-lg)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {UI_STRINGS.TERMINAL_NO_PTY_DATA}
        </div>
      )}
    </div>
  );
}
