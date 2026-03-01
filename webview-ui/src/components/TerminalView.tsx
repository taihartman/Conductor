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
import { TERMINAL_CONFIG } from '../config/colors';
import { TERMINAL_KEYS } from '@shared/sharedConstants';

interface TerminalViewProps {
  sessionId: string;
}

/** Delay before showing the no-PTY-data placeholder (ms). */
const NO_PTY_DATA_DELAY_MS = 1500; // inline-ok: one-off timing constant

/**
 * Safely call fitAddon.fit(), guarding against zero-dimension containers.
 * xterm.js FitAddon fails silently when the container has no width or height
 * (common in narrow tiles or during layout transitions).
 */
function safeFit(fitAddon: FitAddon, container: HTMLElement | null): void {
  if (!container) return;
  const { clientWidth, clientHeight } = container;
  if (clientWidth === 0 || clientHeight === 0) return;
  try {
    fitAddon.fit();
  } catch {
    // Ignore fit errors during layout transitions
  }
}

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
    const timer = setTimeout(() => {
      setShowPlaceholder(true);
    }, NO_PTY_DATA_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ptyBuffer, sessionId]);

  // Initialize terminal on mount
  useEffect(() => {
    if (!containerRef.current) return;

    // Resolve CSS variable for Canvas 2D renderer — ctx.font cannot parse var() expressions.
    // NOTE: Resolved once at mount; runtime theme changes require component remount.
    const resolvedFont = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-mono')
      .trim();
    const fontFamily = resolvedFont || TERMINAL_CONFIG.FONT_FALLBACK;

    const terminal = new Terminal({
      fontSize: TERMINAL_CONFIG.FONT_SIZE,
      fontFamily,
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

    // Prong 2: Intercept modified keys that reach xterm.js but need different escape sequences
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;
      if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        vscode.postMessage({ type: 'pty:input', sessionId, data: TERMINAL_KEYS.SHIFT_ENTER });
        return false;
      }
      if (event.key === 'Backspace' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        vscode.postMessage({ type: 'pty:input', sessionId, data: TERMINAL_KEYS.CMD_BACKSPACE });
        return false;
      }
      return true;
    });

    // Send keystrokes to extension
    terminal.onData((data) => {
      vscode.postMessage({ type: 'pty:input', sessionId, data });
    });

    // Send resize events to extension
    terminal.onResize(({ cols, rows }) => {
      vscode.postMessage({ type: 'pty:resize', sessionId, cols, rows });
    });

    // Gate live pty:data writes and buffer replay until terminal has real dimensions.
    // ResizeObserver is the authoritative signal that the container has completed
    // layout — no timing guesses (rAF/setTimeout) needed. terminalRef.current stays
    // null until after the first successful fit, which naturally gates the pty:data
    // handler (line ~165) that uses terminalRef.current?.write().
    let fitted = false;

    const initializeAfterFit = (): void => {
      if (fitted) return;
      if (!containerRef.current || containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      fitted = true;
      safeFit(fitAddon, containerRef.current);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      if (ptyBuffer) {
        terminal.write(ptyBuffer);
      }
      terminal.focus();
    };

    // Observe container resize — also serves as the primary initialization trigger
    const resizeObserver = new ResizeObserver(() => {
      if (!fitted) {
        initializeAfterFit();
      } else {
        safeFit(fitAddon, containerRef.current);
      }
    });
    resizeObserver.observe(containerRef.current);

    // Fallback: if the container already has dimensions when the observer is
    // attached (e.g. same-size session switch), ResizeObserver may not fire.
    // A single rAF picks it up; if ResizeObserver fires first, the fitted
    // flag prevents double-replay.
    const rafId = requestAnimationFrame(() => {
      initializeAfterFit();
    });

    // Also listen for synthetic window resize events (fired by forceRelayout()
    // when the panel transitions from hidden to visible). ResizeObserver alone
    // doesn't fire when the container dimensions haven't technically changed.
    const handleWindowResize = (): void => {
      if (!fitted) {
        initializeAfterFit();
      } else {
        safeFit(fitAddon, containerRef.current);
      }
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
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
      if (msg.type === 'pty:data') {
        if (msg.sessionId === sessionId) {
          terminalRef.current?.write(msg.data);
        }
      }
      // Prong 1: Receive injected key sequences from VS Code keybindings
      if (msg.type === 'terminal:inject-keys') {
        vscode.postMessage({ type: 'pty:input', sessionId, data: msg.data });
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
