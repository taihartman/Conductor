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
import { LOG_PREFIX, FS_PATHS } from '../constants';

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
  /** Slug eagerly extracted from the first JSONL record (if available). */
  peekedSlug?: string;
  /** Working directory eagerly extracted from the first JSONL record. */
  peekedCwd?: string;
  /** Git branch eagerly extracted from the first JSONL record. */
  peekedGitBranch?: string;
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
    this.claudeProjectsDir =
      claudeDir || path.join(os.homedir(), FS_PATHS.CLAUDE_DIR, FS_PATHS.PROJECTS_DIR);
    console.log(`${LOG_PREFIX.SCANNER} Projects dir: ${this.claudeProjectsDir}`);
  }

  /**
   * Returns the absolute path to the Claude projects directory.
   *
   * @returns The resolved projects directory path
   */
  getProjectsDir(): string {
    return this.claudeProjectsDir;
  }

  /**
   * Resolve the Claude projects subdirectory for a given workspace path.
   *
   * @remarks
   * Claude Code stores sessions in `~/.claude/projects/<encoded-path>/` where
   * the encoded path is the absolute workspace path with `/` replaced by `-`
   * (e.g., `/Users/foo/my-project` becomes `-Users-foo-my-project`).
   *
   * @param workspacePath - Absolute filesystem path to the VS Code workspace
   * @returns Absolute path to the project directory, or `undefined` if it doesn't exist
   */
  getProjectDirForWorkspace(workspacePath: string): string | undefined {
    // Normalize Windows backslashes to forward slashes, strip trailing slash, then encode
    const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const encoded = normalized.replace(/\//g, '-');
    const fullPath = path.join(this.claudeProjectsDir, encoded);

    if (fs.existsSync(fullPath)) {
      console.log(`${LOG_PREFIX.SCANNER} Workspace "${workspacePath}" → project dir: ${encoded}`);
      return fullPath;
    }

    console.log(
      `${LOG_PREFIX.SCANNER} No project dir for workspace "${workspacePath}" (expected: ${encoded})`
    );
    return undefined;
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
   * Discover JSONL transcript files across all (or specific) project directories.
   *
   * @remarks
   * Scans both top-level `.jsonl` files and `subagents/` subdirectories.
   * Results are sorted by modification time (newest first).
   *
   * @param projectDirs - Scan only these directories (default: all project dirs)
   * @param maxAgeMs - Exclude files older than this many milliseconds
   * @returns Array of {@link SessionFile} entries sorted by modification time
   */
  scanSessionFiles(projectDirs?: string[], maxAgeMs?: number): SessionFile[] {
    const dirs =
      projectDirs !== undefined
        ? projectDirs.map((d) => ({ name: path.basename(d), path: d }))
        : this.scanProjectDirs();
    const scopeLabel = projectDirs !== undefined ? 'scoped' : 'unscoped';
    console.log(
      `${LOG_PREFIX.SCANNER} Scanning ${dirs.length} project dir(s) (${scopeLabel}), maxAge=${maxAgeMs ? Math.round(maxAgeMs / 1000) + 's' : 'none'}`
    );

    const files: SessionFile[] = [];

    for (const dir of dirs) {
      if (!fs.existsSync(dir.path)) {
        continue;
      }

      const entries = fs.readdirSync(dir.path, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(FS_PATHS.JSONL_EXT)) {
          const filePath = path.join(dir.path, entry.name);
          const baseName = entry.name.replace(FS_PATHS.JSONL_EXT, '');
          const isSubAgent = baseName.startsWith(FS_PATHS.AGENT_PREFIX);
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
          const subagentsDir = path.join(dir.path, entry.name, FS_PATHS.SUBAGENTS_DIR);
          try {
            if (!fs.existsSync(subagentsDir)) {
              continue;
            }
            const subEntries = fs.readdirSync(subagentsDir, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (!subEntry.isFile() || !subEntry.name.endsWith(FS_PATHS.JSONL_EXT)) {
                continue;
              }
              const subFilePath = path.join(subagentsDir, subEntry.name);
              const subBaseName = subEntry.name.replace(FS_PATHS.JSONL_EXT, '');

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
