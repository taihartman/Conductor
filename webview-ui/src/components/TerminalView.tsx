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
import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { vscode } from '../vscode';
import { useDashboardStore } from '../store/dashboardStore';

interface TerminalViewProps {
  sessionId: string;
}

export function TerminalView({ sessionId }: TerminalViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyBuffer = useDashboardStore((s) => s.ptyBuffers.get(sessionId) ?? '');

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
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
}
