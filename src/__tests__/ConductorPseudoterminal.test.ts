import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode ---
vi.mock('vscode', () => ({
  EventEmitter: class MockEmitter {
    private listeners: Function[] = [];
    event = (listener: Function) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data: any) {
      this.listeners.forEach((l) => l(data));
    }
    dispose() {
      this.listeners = [];
    }
  },
}));

import { ConductorPseudoterminal } from '../terminal/ConductorPseudoterminal';
import type { PseudoterminalCallbacks } from '../terminal/IConductorPseudoterminal';

function createCallbacks(): PseudoterminalCallbacks & {
  inputCalls: string[];
  resizeCalls: { cols: number; rows: number }[];
  closeCalled: boolean;
} {
  const state = {
    inputCalls: [] as string[],
    resizeCalls: [] as { cols: number; rows: number }[],
    closeCalled: false,
    onInput: (data: string) => {
      state.inputCalls.push(data);
    },
    onResize: (cols: number, rows: number) => {
      state.resizeCalls.push({ cols, rows });
    },
    onClose: () => {
      state.closeCalled = true;
    },
  };
  return state;
}

describe('ConductorPseudoterminal', () => {
  let pty: ConductorPseudoterminal;
  let callbacks: ReturnType<typeof createCallbacks>;

  beforeEach(() => {
    callbacks = createCallbacks();
    pty = new ConductorPseudoterminal(callbacks);
  });

  describe('pre-open buffering', () => {
    it('buffers data written before open()', () => {
      const writeEvents: string[] = [];
      pty.onDidWrite((data) => writeEvents.push(data));

      pty.write('hello');
      pty.write(' world');

      // No data should have been emitted yet
      expect(writeEvents).toHaveLength(0);
    });

    it('flushes buffered data on open()', () => {
      const writeEvents: string[] = [];
      pty.onDidWrite((data) => writeEvents.push(data));

      pty.write('hello');
      pty.write(' world');

      pty.open(undefined);

      expect(writeEvents).toEqual(['hello', ' world']);
    });

    it('clears buffer after flush', () => {
      const writeEvents: string[] = [];
      pty.onDidWrite((data) => writeEvents.push(data));

      pty.write('buffered');
      pty.open(undefined);

      // Reset tracking
      writeEvents.length = 0;

      // Write after open should fire immediately, not replay buffer
      pty.write('live');
      expect(writeEvents).toEqual(['live']);
    });
  });

  describe('write() after open', () => {
    it('fires onDidWrite immediately', () => {
      const writeEvents: string[] = [];
      pty.onDidWrite((data) => writeEvents.push(data));

      pty.open(undefined);
      pty.write('test data');

      expect(writeEvents).toEqual(['test data']);
    });
  });

  describe('handleInput()', () => {
    it('calls inputHandler callback', () => {
      pty.handleInput('user input');
      expect(callbacks.inputCalls).toEqual(['user input']);
    });
  });

  describe('setDimensions()', () => {
    it('calls resizeHandler callback', () => {
      pty.setDimensions({ columns: 80, rows: 24 } as any);
      expect(callbacks.resizeCalls).toEqual([{ cols: 80, rows: 24 }]);
    });
  });

  describe('close()', () => {
    it('calls closeHandler callback', () => {
      pty.close();
      expect(callbacks.closeCalled).toBe(true);
    });
  });

  describe('exit()', () => {
    it('fires onDidClose with the exit code', () => {
      const closeEvents: (number | void)[] = [];
      pty.onDidClose((code) => closeEvents.push(code));

      pty.exit(0);
      expect(closeEvents).toEqual([0]);
    });

    it('fires onDidClose with non-zero code', () => {
      const closeEvents: (number | void)[] = [];
      pty.onDidClose((code) => closeEvents.push(code));

      pty.exit(1);
      expect(closeEvents).toEqual([1]);
    });
  });

  describe('open() with initialDimensions', () => {
    it('calls resizeHandler when dimensions are provided', () => {
      pty.open({ columns: 120, rows: 40 } as any);
      expect(callbacks.resizeCalls).toEqual([{ cols: 120, rows: 40 }]);
    });

    it('does not call resizeHandler when dimensions are undefined', () => {
      pty.open(undefined);
      expect(callbacks.resizeCalls).toHaveLength(0);
    });
  });

  describe('dispose()', () => {
    it('clears pre-open buffer', () => {
      const writeEvents: string[] = [];
      pty.onDidWrite((data) => writeEvents.push(data));

      pty.write('buffered');
      pty.dispose();

      // After dispose, opening should not flush anything
      // (emitters are disposed, so we can't test via events,
      // but we verify no errors are thrown)
      expect(() => pty.open(undefined)).not.toThrow();
    });
  });
});
