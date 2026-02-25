import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ProjectDir {
  name: string;
  path: string;
}

export interface SessionFile {
  sessionId: string;
  filePath: string;
  projectDir: string;
  isSubAgent: boolean;
  modifiedAt: Date;
  parentSessionId?: string;
}

export class ProjectScanner {
  private readonly claudeProjectsDir: string;

  constructor(claudeDir?: string) {
    this.claudeProjectsDir =
      claudeDir || path.join(os.homedir(), '.claude', 'projects');
    console.log(`[ClaudeDashboard:Scanner] Projects dir: ${this.claudeProjectsDir}`);
  }

  getProjectsDir(): string {
    return this.claudeProjectsDir;
  }

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

  scanSessionFiles(projectDir?: string, maxAgeMs?: number): SessionFile[] {
    const dirs = projectDir
      ? [{ name: path.basename(projectDir), path: projectDir }]
      : this.scanProjectDirs();
    console.log(`[ClaudeDashboard:Scanner] Scanning ${dirs.length} project dir(s), maxAge=${maxAgeMs ? Math.round(maxAgeMs / 1000) + 's' : 'none'}`);

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

    return files.sort(
      (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()
    );
  }
}
