import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PtyBridge } from '../terminal/PtyBridge';

describe('PtyBridge', () => {
  let bridge: PtyBridge;

  beforeEach(() => {
    bridge = new PtyBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  describe('registerSession / unregisterSession', () => {
    it('registers a session and reports it via hasSession', () => {
      expect(bridge.hasSession('s1')).toBe(false);
      bridge.registerSession('s1');
      expect(bridge.hasSession('s1')).toBe(true);
    });

    it('unregisters a session and clears its buffer', () => {
      bridge.registerSession('s1');
      bridge.pushData('s1', 'hello');
      bridge.unregisterSession('s1');

      expect(bridge.hasSession('s1')).toBe(false);
      expect(bridge.getBufferedData('s1')).toBe('');
    });

    it('is idempotent when registering the same session twice', () => {
      bridge.registerSession('s1');
      bridge.pushData('s1', 'data');
      bridge.registerSession('s1'); // should not reset buffer
      expect(bridge.getBufferedData('s1')).toBe('data');
    });
  });

  describe('pushData / getBufferedData', () => {
    it('accumulates pushed data', () => {
      bridge.registerSession('s1');
      bridge.pushData('s1', 'hello ');
      bridge.pushData('s1', 'world');
      expect(bridge.getBufferedData('s1')).toBe('hello world');
    });

    it('returns empty string for unregistered sessions', () => {
      expect(bridge.getBufferedData('unknown')).toBe('');
    });

    it('silently drops data for unregistered sessions', () => {
      bridge.pushData('unknown', 'data');
      expect(bridge.getBufferedData('unknown')).toBe('');
    });
  });

  describe('ring buffer overflow', () => {
    it('truncates old data when buffer exceeds max size', () => {
      bridge.registerSession('s1');

      // The default buffer size is 102400 (100KB).
      // Push more data than the buffer can hold.
      const chunk = 'A'.repeat(60000);
      bridge.pushData('s1', chunk);
      bridge.pushData('s1', chunk); // Total: 120KB, exceeds 100KB

      const buffered = bridge.getBufferedData('s1');
      expect(buffered.length).toBe(102400);
      // Should contain only the most recent data (tail)
      expect(buffered).toBe('A'.repeat(102400));
    });

    it('preserves most recent data after overflow', () => {
      bridge.registerSession('s1');

      // Fill buffer to capacity
      const filler = 'X'.repeat(102400);
      bridge.pushData('s1', filler);

      // Push new data that causes overflow
      const recent = 'NEW_DATA_HERE';
      bridge.pushData('s1', recent);

      const buffered = bridge.getBufferedData('s1');
      expect(buffered.endsWith(recent)).toBe(true);
      expect(buffered.length).toBe(102400);
      // Verify old data was trimmed from the front
      expect(buffered.startsWith('X')).toBe(true);
    });
  });

  describe('multiple sessions', () => {
    it('isolates buffers between sessions', () => {
      bridge.registerSession('s1');
      bridge.registerSession('s2');

      bridge.pushData('s1', 'session-one');
      bridge.pushData('s2', 'session-two');

      expect(bridge.getBufferedData('s1')).toBe('session-one');
      expect(bridge.getBufferedData('s2')).toBe('session-two');
    });

    it('unregistering one session does not affect another', () => {
      bridge.registerSession('s1');
      bridge.registerSession('s2');

      bridge.pushData('s1', 'keep-this');
      bridge.pushData('s2', 'remove-this');

      bridge.unregisterSession('s2');

      expect(bridge.getBufferedData('s1')).toBe('keep-this');
      expect(bridge.hasSession('s2')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('clears all sessions and buffers', () => {
      bridge.registerSession('s1');
      bridge.registerSession('s2');
      bridge.pushData('s1', 'data1');
      bridge.pushData('s2', 'data2');

      bridge.dispose();

      expect(bridge.hasSession('s1')).toBe(false);
      expect(bridge.hasSession('s2')).toBe(false);
    });
  });
});
