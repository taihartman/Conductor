/**
 * @module PtyBridge
 *
 * Relays PTY I/O between Conductor-launched sessions and the webview terminal.
 * Maintains a ring buffer per session so the webview can replay recent output
 * after reconnect (e.g., webview reload or toggle back to terminal view).
 */

import { IPtyBridge } from './IPtyBridge';
import { LOG_PREFIX, PTY } from '../constants';

/**
 * Ring buffer that stores the most recent N bytes of terminal output.
 *
 * @remarks
 * Implemented as a simple string truncation — when the buffer exceeds
 * `maxSize`, the oldest data is discarded by slicing from the end.
 */
class RingBuffer {
  private buffer = '';
  private readonly maxSize: number;

  constructor(maxSize: number = PTY.RING_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  push(data: string): void {
    this.buffer += data;
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(-this.maxSize);
    }
  }

  getContents(): string {
    return this.buffer;
  }

  clear(): void {
    this.buffer = '';
  }
}

/**
 * Manages per-session ring buffers for PTY output relay to the webview.
 *
 * @remarks
 * The PtyBridge doesn't directly send IPC messages — it stores data that
 * DashboardPanel reads via `getBufferedData()` for replay, and the live
 * data flow goes through SessionLauncher.onPtyData → DashboardPanel → webview.
 */
export class PtyBridge implements IPtyBridge {
  private readonly buffers = new Map<string, RingBuffer>();

  constructor() {
    console.log(`${LOG_PREFIX.PTY_BRIDGE} Initialized`);
  }

  /**
   * Register a new session and allocate its ring buffer.
   * @param sessionId
   */
  registerSession(sessionId: string): void {
    if (this.buffers.has(sessionId)) {
      console.log(`${LOG_PREFIX.PTY_BRIDGE} Session ${sessionId} already registered`);
      return;
    }
    this.buffers.set(sessionId, new RingBuffer());
    console.log(`${LOG_PREFIX.PTY_BRIDGE} Registered session ${sessionId}`);
  }

  /**
   * Unregister a session and clear its ring buffer.
   * @param sessionId
   */
  unregisterSession(sessionId: string): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer) {
      buffer.clear();
      this.buffers.delete(sessionId);
      console.log(`${LOG_PREFIX.PTY_BRIDGE} Unregistered session ${sessionId}`);
    }
  }

  /**
   * Append data to the session's ring buffer.
   * @param sessionId
   * @param data
   */
  pushData(sessionId: string, data: string): void {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) {
      return;
    }
    buffer.push(data);
  }

  /**
   * Return the ring buffer contents for replay.
   * @param sessionId
   * @returns Buffered terminal output
   */
  getBufferedData(sessionId: string): string {
    const buffer = this.buffers.get(sessionId);
    return buffer?.getContents() ?? '';
  }

  /**
   * Check if a session is registered.
   * @param sessionId
   * @returns `true` if the session has a ring buffer
   */
  hasSession(sessionId: string): boolean {
    return this.buffers.has(sessionId);
  }

  /** Clear all buffers and release resources. */
  dispose(): void {
    for (const [sessionId] of this.buffers) {
      console.log(`${LOG_PREFIX.PTY_BRIDGE} Clearing buffer for ${sessionId}`);
    }
    this.buffers.clear();
    console.log(`${LOG_PREFIX.PTY_BRIDGE} Disposed`);
  }
}
