/**
 * @module ProjectScanner
 *
 * Discovers Claude Code project directories and JSONL transcript files.
 *
 * @remarks
 * Scans `~/.claude/projects/` (or a custom directory) for `.jsonl` transcript
 * files. Supports two file layouts:
 * - **Top-level sessions**: `<project-dir>/<session-uuid>.jsonl`
 * - **Sub-agent sessions**: `<project-dir>/<parent-uuid>/subagents/<agent-uuid>.jsonl`
 *
 * Files with names starting with `agent-` are identified as sub-agent sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** A discovered Claude Code project directory. */
export interface ProjectDir {
  /** Directory name (the path-encoded project path). */
  name: string;
  /** Absolute filesystem path to the project directory. */
  path: string;
}

/**
 * A discovered JSONL transcript file representing a Claude Code session.
 *
 * @remarks
 * Sub-agent files (identified by the `agent-` filename prefix or location in a
 * `subagents/` subdirectory) have `isSubAgent: true` and may include a
 * `parentSessionId` linking them to the spawning session.
 */
export interface SessionFile {
  /** Session identifier derived from the filename (without `.jsonl` extension). */
  sessionId: string;
  /** Absolute path to the JSONL file. */
  filePath: string;
  /** Name of the parent project directory. */
  projectDir: string;
  /** Whether this session was spawned as a sub-agent. */
  isSubAgent: boolean;
  /** Last modification time of the file. */
  modifiedAt: Date;
  /** Session ID of the parent that spawned this sub-agent. */
  parentSessionId?: string;
}

/**
 * Scans the Claude Code projects directory for transcript files.
 *
 * @remarks
 * Used by {@link TranscriptWatcher} for initial file discovery and periodic
 * re-scanning. Supports an optional `maxAgeMs` filter to limit results to
 * recently modified files.
 */
export class ProjectScanner {
  private readonly claudeProjectsDir: string;

  /**
   * @param claudeDir - Override the default `~/.claude/projects/` directory.
   * Primarily used for testing.
   */
  constructor(claudeDir?: string) {
    this.claudeProjectsDir = claudeDir || path.join(os.homedir(), '.claude', 'projects');
    console.log(`[Conductor:Scanner] Projects dir: ${this.claudeProjectsDir}`);
  }

  /** Returns the absolute path to the Claude projects directory. */
  getProjectsDir(): string {
    return this.claudeProjectsDir;
  }

  /**
   * List all project directories under the Claude projects root.
   *
   * @returns Array of {@link ProjectDir} entries, or empty array if the root doesn't exist
   */
  scanProjectDirs(): ProjectDir[] {
    if (!fs.existsSync(this.claudeProjectsDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.claudeProjectsDir, {
      withFileTypes: true,
    });

    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: path.join(this.claudeProjectsDir, e.name),
      }));
  }

  /**
   * Discover JSONL transcript files across all (or one) project directories.
   *
   * @remarks
   * Scans both top-level `.jsonl` files and `subagents/` subdirectories.
   * Results are sorted by modification time (newest first).
   *
   * @param projectDir - Scan only this directory (default: all project dirs)
   * @param maxAgeMs - Exclude files older than this many milliseconds
   * @returns Array of {@link SessionFile} entries sorted by modification time
   */
  scanSessionFiles(projectDir?: string, maxAgeMs?: number): SessionFile[] {
    const dirs = projectDir
      ? [{ name: path.basename(projectDir), path: projectDir }]
      : this.scanProjectDirs();
    console.log(
      `[Conductor:Scanner] Scanning ${dirs.length} project dir(s), maxAge=${maxAgeMs ? Math.round(maxAgeMs / 1000) + 's' : 'none'}`
    );

    const files: SessionFile[] = [];

    for (const dir of dirs) {
      if (!fs.existsSync(dir.path)) {
        continue;
      }

      const entries = fs.readdirSync(dir.path, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const filePath = path.join(dir.path, entry.name);
          const baseName = entry.name.replace('.jsonl', '');
          const isSubAgent = baseName.startsWith('agent-');
          const sessionId = baseName;

          let modifiedAt: Date;
          try {
            const stat = fs.statSync(filePath);
            modifiedAt = stat.mtime;
          } catch {
            modifiedAt = new Date(0);
          }

          if (maxAgeMs !== undefined && Date.now() - modifiedAt.getTime() > maxAgeMs) {
            continue;
          }

          files.push({
            sessionId,
            filePath,
            projectDir: dir.name,
            isSubAgent,
            modifiedAt,
          });
        }

        // Scan subdirectories for sub-agent files: [UUID]/subagents/*.jsonl
        if (entry.isDirectory()) {
          const subagentsDir = path.join(dir.path, entry.name, 'subagents');
          try {
            if (!fs.existsSync(subagentsDir)) {
              continue;
            }
            const subEntries = fs.readdirSync(subagentsDir, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (!subEntry.isFile() || !subEntry.name.endsWith('.jsonl')) {
                continue;
              }
              const subFilePath = path.join(subagentsDir, subEntry.name);
              const subBaseName = subEntry.name.replace('.jsonl', '');

              let subModifiedAt: Date;
              try {
                const stat = fs.statSync(subFilePath);
                subModifiedAt = stat.mtime;
              } catch {
                subModifiedAt = new Date(0);
              }

              if (maxAgeMs !== undefined && Date.now() - subModifiedAt.getTime() > maxAgeMs) {
                continue;
              }

              files.push({
                sessionId: subBaseName,
                filePath: subFilePath,
                projectDir: dir.name,
                isSubAgent: true,
                modifiedAt: subModifiedAt,
                parentSessionId: entry.name,
              });
            }
          } catch {
            // Permission errors, symlinks, disappearing dirs — skip gracefully
          }
        }
      }
    }

    return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  }
}
