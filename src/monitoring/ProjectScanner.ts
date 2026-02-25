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
}

export class ProjectScanner {
  private readonly claudeProjectsDir: string;

  constructor(claudeDir?: string) {
    this.claudeProjectsDir =
      claudeDir || path.join(os.homedir(), '.claude', 'projects');
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

    const files: SessionFile[] = [];

    for (const dir of dirs) {
      if (!fs.existsSync(dir.path)) {
        continue;
      }

      const entries = fs.readdirSync(dir.path, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
          continue;
        }

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
    }

    return files.sort(
      (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()
    );
  }
}
