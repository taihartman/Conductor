/**
 * @module TranscriptWatcher
 *
 * Hybrid file watcher combining VS Code FileSystemWatcher with polling.
 *
 * @remarks
 * Uses a dual strategy for reliability across platforms:
 * 1. **FileSystemWatcher** — Immediate notification of new `.jsonl` files
 * 2. **Polling** — 1-second interval reads new data from tracked files
 * 3. **Periodic scan** — 30-second interval discovers files missed by the watcher
 *
 * The polling fallback ensures data is captured even when filesystem events are
 * unreliable (e.g., on network drives or certain Linux inotify configurations).
 * Files older than {@link MAX_AGE_MS} (1 hour) are excluded from scans.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectScanner, SessionFile } from './ProjectScanner';
import { JsonlParser, ParseResult } from './JsonlParser';
import { JsonlRecord } from '../models/types';
import { LOG_PREFIX, FS_PATHS } from '../constants';

/** Event emitted when new records are read from a transcript file. */
export interface WatcherEvent {
  /** The session file that produced the records. */
  sessionFile: SessionFile;
  /** Newly parsed records (since the last read). */
  records: JsonlRecord[];
}

/** Interval for periodic file system scans to discover new session files. */
const SCAN_INTERVAL_MS = 30_000;
/** Interval for polling tracked files for new data. */
const POLL_INTERVAL_MS = 1_000;
/** Maximum age of session files to include in scans (1 hour). */
const MAX_AGE_MS = 1 * 60 * 60 * 1000;

/**
 * Watches Claude Code transcript files for new records using a hybrid strategy.
 *
 * @remarks
 * Implements `vscode.Disposable` for proper cleanup of timers and watchers.
 * Each tracked file gets its own {@link JsonlParser} instance and byte offset.
 *
 * Lifecycle: `constructor()` → {@link start} → (running) → {@link dispose}
 */
export class TranscriptWatcher implements vscode.Disposable {
  private readonly scanner: ProjectScanner;
  private readonly parsers: Map<string, JsonlParser> = new Map();
  private readonly offsets: Map<string, number> = new Map();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly trackedFiles: Map<string, SessionFile> = new Map();
  /**
   * Files removed via {@link removeTracked} are tombstoned so periodic scans
   * don't re-discover them. Maps file path → mtime (ms) at removal time.
   * A tombstoned file is only re-added if its current mtime is newer than the
   * stored value, indicating genuinely new data was written.
   */
  private readonly tombstones: Map<string, number> = new Map();
  private scanTimer: ReturnType<typeof setInterval> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly onRecordsCallback: (event: WatcherEvent) => void;
  private readonly onNewFileCallback: (file: SessionFile) => void;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly projectDirs: string[] | undefined;
  /** Whether the watcher is scoped to specific directories (vs. watching all projects). */
  private readonly isScoped: boolean;

  constructor(
    scanner: ProjectScanner,
    outputChannel: vscode.OutputChannel,
    onRecords: (event: WatcherEvent) => void,
    onNewFile: (file: SessionFile) => void,
    projectDirs?: string[]
  ) {
    this.scanner = scanner;
    this.outputChannel = outputChannel;
    this.onRecordsCallback = onRecords;
    this.onNewFileCallback = onNewFile;
    this.projectDirs = projectDirs;
    this.isScoped = projectDirs !== undefined;
  }

  /**
   * Start watching for transcript files and polling for new records.
   *
   * @remarks
   * Sets up the FileSystemWatcher, performs an initial scan, and starts
   * both the scan timer ({@link SCAN_INTERVAL_MS}) and poll timer ({@link POLL_INTERVAL_MS}).
   */
  start(): void {
    const scope = this.isScoped
      ? this.projectDirs!.length > 0
        ? this.projectDirs!.map((d) => path.basename(d)).join(', ')
        : 'scoped but empty (waiting for project dir)'
      : 'all projects';
    console.log(`${LOG_PREFIX.WATCHER} Starting transcript watcher (scope: ${scope})...`);

    // Scoped but empty: no dirs to watch or scan — poll timer still runs
    // so that files added via addTrackedFile() get polled.
    if (!this.isScoped || this.projectDirs!.length > 0) {
      this.setupFileWatchers();
      this.scanForFiles();
      this.scanTimer = setInterval(() => this.scanForFiles(), SCAN_INTERVAL_MS);
    }
    this.pollTimer = setInterval(() => this.pollTracked(), POLL_INTERVAL_MS);
    console.log(
      `${LOG_PREFIX.WATCHER} Watcher started (scan=${this.scanTimer ? SCAN_INTERVAL_MS + 'ms' : 'disabled'}, poll=${POLL_INTERVAL_MS}ms)`
    );
  }

  private scanForFiles(): void {
    const files = this.scanner.scanSessionFiles(this.projectDirs, MAX_AGE_MS);
    let newCount = 0;
    for (const file of files) {
      if (this.trackedFiles.has(file.filePath)) continue;

      // Skip tombstoned files unless they have genuinely new data (newer mtime)
      const tombstoneTime = this.tombstones.get(file.filePath);
      if (tombstoneTime !== undefined && file.modifiedAt.getTime() <= tombstoneTime) {
        continue;
      }

      // File is either not tombstoned, or has new writes since removal — track it
      this.tombstones.delete(file.filePath);
      console.log(
        `${LOG_PREFIX.WATCHER} Tracking new file: ${file.sessionId} (${file.projectDir})`
      );
      this.trackedFiles.set(file.filePath, file);
      this.onNewFileCallback(file);
      newCount++;
    }

    // Evict stale tombstones (file older than MAX_AGE_MS won't be scanned anyway)
    if (this.tombstones.size > 0) {
      const cutoff = Date.now() - MAX_AGE_MS;
      for (const [filePath, mtime] of this.tombstones) {
        if (mtime < cutoff) {
          this.tombstones.delete(filePath);
        }
      }
    }

    console.log(
      `${LOG_PREFIX.WATCHER} Scan found ${files.length} files, ${newCount} new, ${this.trackedFiles.size} tracked`
    );
    this.outputChannel.appendLine(
      `Scan found ${files.length} recent session files (${this.trackedFiles.size} tracked)`
    );
  }

  private pollTracked(): void {
    for (const file of this.trackedFiles.values()) {
      this.readNewRecords(file);
    }
  }

  private setupFileWatchers(): void {
    // Watch each scoped directory individually, or the global projects dir when unscoped.
    // Note: this method is only called when `!isScoped || projectDirs.length > 0`,
    // so the scoped-but-empty case is unreachable here.
    const watchDirs = this.isScoped ? this.projectDirs! : [this.scanner.getProjectsDir()];

    for (const watchDir of watchDirs) {
      console.log(`${LOG_PREFIX.WATCHER} Setting up FileSystemWatcher on: ${watchDir}`);

      try {
        const pattern = new vscode.RelativePattern(vscode.Uri.file(watchDir), '**/*.jsonl');

        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate((uri) => {
          const filePath = uri.fsPath;
          // New file creation events bypass tombstones — the OS is telling us
          // there's genuinely new data, so clear any stale tombstone.
          this.tombstones.delete(filePath);
          if (!this.trackedFiles.has(filePath)) {
            const baseName = path.basename(filePath, FS_PATHS.JSONL_EXT);
            const parentDir = path.basename(path.dirname(filePath));
            const isSubAgent = baseName.startsWith(FS_PATHS.AGENT_PREFIX);

            let projectDir: string;
            let parentSessionId: string | undefined;

            if (parentDir === FS_PATHS.SUBAGENTS_DIR) {
              // File is in [UUID]/subagents/agent-xyz.jsonl
              const grandparentDir = path.basename(path.dirname(path.dirname(filePath)));
              const greatGrandparentDir = path.basename(
                path.dirname(path.dirname(path.dirname(filePath)))
              );
              projectDir = greatGrandparentDir;
              parentSessionId = grandparentDir;
            } else {
              projectDir = parentDir;
              parentSessionId = undefined;
            }

            const sessionFile: SessionFile = {
              sessionId: baseName,
              filePath,
              projectDir,
              isSubAgent,
              modifiedAt: new Date(),
              parentSessionId,
            };
            this.trackedFiles.set(filePath, sessionFile);
            this.onNewFileCallback(sessionFile);
            this.outputChannel.appendLine(`New session file: ${baseName}`);
          }
        });

        this.disposables.push(watcher);
      } catch (e) {
        this.outputChannel.appendLine(
          `FileSystemWatcher setup failed for ${watchDir}: ${e}. Falling back to polling only.`
        );
      }
    }
  }

  /**
   * Stop tracking a file (e.g., when the session is cleaned up as stale).
   *
   * @param filePath - Absolute path of the file to stop watching
   */
  removeTracked(filePath: string): void {
    const file = this.trackedFiles.get(filePath);
    this.trackedFiles.delete(filePath);
    this.parsers.delete(filePath);
    this.offsets.delete(filePath);
    // Tombstone the file so periodic scans don't re-discover it.
    // Use the file's known mtime so it only comes back if genuinely new data is written.
    this.tombstones.set(filePath, file?.modifiedAt.getTime() ?? Date.now());
  }

  /**
   * Read and parse any new records from a tracked session file.
   *
   * @remarks
   * Uses the file's {@link JsonlParser} and byte offset to read incrementally.
   * If new records are found, invokes the `onRecords` callback. The byte offset
   * is always advanced, even if no complete records were parsed (to skip past
   * partial writes).
   *
   * @param file - The session file to read from
   */
  readNewRecords(file: SessionFile): void {
    const currentOffset = this.offsets.get(file.filePath) || 0;

    let parser = this.parsers.get(file.filePath);
    if (!parser) {
      parser = new JsonlParser();
      this.parsers.set(file.filePath, parser);
    }

    const result: ParseResult = parser.parseIncremental(file.filePath, currentOffset);

    if (result.records.length > 0) {
      console.log(
        `${LOG_PREFIX.WATCHER} Read ${result.records.length} new record(s) from ${file.sessionId} (offset ${currentOffset} → ${result.newOffset})`
      );
      this.offsets.set(file.filePath, result.newOffset);
      this.onRecordsCallback({ sessionFile: file, records: result.records });
    } else if (result.newOffset > currentOffset) {
      this.offsets.set(file.filePath, result.newOffset);
    }
  }

  /** Stop all timers, file watchers, and release resources. */
  dispose(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.parsers.clear();
    this.offsets.clear();
    this.trackedFiles.clear();
    this.tombstones.clear();
  }
}
