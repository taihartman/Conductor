import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectScanner, SessionFile } from './ProjectScanner';
import { JsonlParser, ParseResult } from './JsonlParser';
import { JsonlRecord } from '../models/types';

export interface WatcherEvent {
  sessionFile: SessionFile;
  records: JsonlRecord[];
}

const SCAN_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class TranscriptWatcher implements vscode.Disposable {
  private readonly scanner: ProjectScanner;
  private readonly parsers: Map<string, JsonlParser> = new Map();
  private readonly offsets: Map<string, number> = new Map();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly trackedFiles: Map<string, SessionFile> = new Map();
  private scanTimer: ReturnType<typeof setInterval> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly onRecordsCallback: (event: WatcherEvent) => void;
  private readonly onNewFileCallback: (file: SessionFile) => void;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(
    scanner: ProjectScanner,
    outputChannel: vscode.OutputChannel,
    onRecords: (event: WatcherEvent) => void,
    onNewFile: (file: SessionFile) => void
  ) {
    this.scanner = scanner;
    this.outputChannel = outputChannel;
    this.onRecordsCallback = onRecords;
    this.onNewFileCallback = onNewFile;
  }

  start(): void {
    this.setupFileWatcher();
    this.scanForFiles();
    this.scanTimer = setInterval(() => this.scanForFiles(), SCAN_INTERVAL_MS);
    this.pollTimer = setInterval(() => this.pollTracked(), POLL_INTERVAL_MS);
  }

  private scanForFiles(): void {
    const files = this.scanner.scanSessionFiles(undefined, MAX_AGE_MS);
    for (const file of files) {
      if (!this.trackedFiles.has(file.filePath)) {
        this.trackedFiles.set(file.filePath, file);
        this.onNewFileCallback(file);
      }
    }
    this.outputChannel.appendLine(
      `Scan found ${files.length} recent session files (${this.trackedFiles.size} tracked)`
    );
  }

  private pollTracked(): void {
    for (const file of this.trackedFiles.values()) {
      this.readNewRecords(file);
    }
  }

  private setupFileWatcher(): void {
    const projectsDir = this.scanner.getProjectsDir();

    try {
      const pattern = new vscode.RelativePattern(
        vscode.Uri.file(projectsDir),
        '**/*.jsonl'
      );

      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidCreate((uri) => {
        const filePath = uri.fsPath;
        if (!this.trackedFiles.has(filePath)) {
          const baseName = path.basename(filePath, '.jsonl');
          const dirName = path.basename(path.dirname(filePath));
          const sessionFile: SessionFile = {
            sessionId: baseName,
            filePath,
            projectDir: dirName,
            isSubAgent: baseName.startsWith('agent-'),
            modifiedAt: new Date(),
          };
          this.trackedFiles.set(filePath, sessionFile);
          this.onNewFileCallback(sessionFile);
          this.outputChannel.appendLine(`New session file: ${baseName}`);
        }
      });

      this.disposables.push(watcher);
    } catch (e) {
      this.outputChannel.appendLine(
        `FileSystemWatcher setup failed: ${e}. Falling back to polling only.`
      );
    }
  }

  readNewRecords(file: SessionFile): void {
    const currentOffset = this.offsets.get(file.filePath) || 0;

    let parser = this.parsers.get(file.filePath);
    if (!parser) {
      parser = new JsonlParser();
      this.parsers.set(file.filePath, parser);
    }

    const result: ParseResult = parser.parseIncremental(
      file.filePath,
      currentOffset
    );

    if (result.records.length > 0) {
      this.offsets.set(file.filePath, result.newOffset);
      this.onRecordsCallback({ sessionFile: file, records: result.records });
    } else if (result.newOffset > currentOffset) {
      this.offsets.set(file.filePath, result.newOffset);
    }
  }

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
  }
}
