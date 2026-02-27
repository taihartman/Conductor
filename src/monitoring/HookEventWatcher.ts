/**
 * @module HookEventWatcher
 *
 * Watches `~/.conductor/events/` for per-session hook event JSONL files
 * written by conductor-hook.sh. Polls at 1s intervals, reads new bytes
 * from each file using byte offset tracking, and emits parsed hook events.
 *
 * @remarks
 * Does NOT reuse {@link JsonlParser} — hook event lines use `e`/`ts`/`sid`
 * keys, not the `type` field that JsonlParser validates. Uses its own
 * lightweight parser with the same incremental byte-offset technique.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HookEvent } from '../models/types';
import { IHookEventWatcher } from './IHookEventWatcher';
import { LOG_PREFIX } from '../constants';

/** Polling interval for checking event files (ms). */
const POLL_INTERVAL_MS = 1_000;

/** Stale file threshold: delete event files older than this (ms). */
const STALE_FILE_MS = 4 * 60 * 60 * 1000;

/** Per-file tracking state for incremental reads. */
interface FileTracker {
  /** Byte offset of the next unread byte. */
  offset: number;
  /** Partial line buffer (from a read that split mid-line). */
  lineBuffer: string;
  /** Last observed mtime (ms since epoch) for change detection. */
  lastMtimeMs: number;
}

/**
 * Watches a directory of per-session hook event JSONL files.
 *
 * @remarks
 * Each file is named `<session-id>.jsonl` and contains one JSON line per
 * hook event. The watcher polls the directory at 1s intervals, detects
 * new or changed files via mtime comparison, and reads only new bytes
 * from each changed file.
 */
export class HookEventWatcher implements IHookEventWatcher {
  private readonly eventsDir: string;
  private readonly trackers: Map<string, FileTracker> = new Map();
  private pollTimer?: ReturnType<typeof setInterval>;

  private readonly _onHookEvents = new vscode.EventEmitter<{
    sessionId: string;
    events: HookEvent[];
  }>();
  public readonly onHookEvents = this._onHookEvents.event;

  constructor(eventsDir: string) {
    this.eventsDir = eventsDir;
  }

  /** Begin polling the events directory for new hook event files. */
  start(): void {
    console.log(`${LOG_PREFIX.HOOK_WATCHER} Starting (dir: ${this.eventsDir})`);
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    // Initial poll immediately
    this.poll();
  }

  /** Stop polling and release resources. */
  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.trackers.clear();
    this._onHookEvents.dispose();
  }

  private poll(): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.eventsDir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist yet — normal before first hook fires
      return;
    }

    const now = Date.now();
    const seenFiles = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

      const filePath = path.join(this.eventsDir, entry.name);
      const sessionId = entry.name.slice(0, -'.jsonl'.length);
      seenFiles.add(sessionId);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      // Delete stale files (older than 4 hours)
      if (now - stat.mtimeMs > STALE_FILE_MS) {
        this.deleteStaleFile(filePath, sessionId);
        continue;
      }

      let tracker = this.trackers.get(sessionId);
      if (!tracker) {
        tracker = { offset: 0, lineBuffer: '', lastMtimeMs: 0 };
        this.trackers.set(sessionId, tracker);
      }

      // Skip if file hasn't changed
      if (stat.mtimeMs <= tracker.lastMtimeMs && stat.size <= tracker.offset) {
        continue;
      }

      tracker.lastMtimeMs = stat.mtimeMs;
      const events = this.readNewEvents(filePath, tracker);
      if (events.length > 0) {
        this._onHookEvents.fire({ sessionId, events });
      }
    }

    // Clean up trackers for files that no longer exist
    for (const sessionId of this.trackers.keys()) {
      if (!seenFiles.has(sessionId)) {
        this.trackers.delete(sessionId);
      }
    }
  }

  private readNewEvents(filePath: string, tracker: FileTracker): HookEvent[] {
    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      return [];
    }

    try {
      const stat = fs.fstatSync(fd);
      if (stat.size <= tracker.offset) return [];

      const bytesToRead = stat.size - tracker.offset;
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, tracker.offset);
      tracker.offset += bytesRead;

      const chunk = buffer.toString('utf8', 0, bytesRead);
      const raw = tracker.lineBuffer + chunk;
      const lines = raw.split('\n');

      // Last element may be a partial line
      tracker.lineBuffer = lines.pop() ?? '';

      const events: HookEvent[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (
            typeof parsed.e === 'string' &&
            typeof parsed.ts === 'number' &&
            typeof parsed.sid === 'string'
          ) {
            events.push(parsed as unknown as HookEvent);
          }
        } catch {
          // Malformed line — skip silently
        }
      }

      return events;
    } finally {
      fs.closeSync(fd);
    }
  }

  private deleteStaleFile(filePath: string, sessionId: string): void {
    try {
      fs.unlinkSync(filePath);
      this.trackers.delete(sessionId);
      console.log(`${LOG_PREFIX.HOOK_WATCHER} Deleted stale event file: ${sessionId}`);
    } catch {
      // Ignore — file may already be gone
    }
  }
}
