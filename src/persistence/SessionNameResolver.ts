/**
 * Resolves display-friendly session names from user prompts and plan files.
 *
 * @remarks
 * Reads plan files from `~/.claude/plans/<slug>.md` asynchronously.
 * Gracefully returns `undefined` when files don't exist or can't be read.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { FS_PATHS } from '../constants';
import { extractSessionName, extractPlanTitle } from '../utils/textUtils';
import { ISessionNameResolver } from './ISessionNameResolver';

/** @see {@link ISessionNameResolver} */
export class SessionNameResolver implements ISessionNameResolver {
  private readonly plansDir: string;

  /** @param plansDir - Override plans directory path (defaults to `~/.claude/plans`). */
  constructor(plansDir?: string) {
    this.plansDir = plansDir ?? path.join(os.homedir(), FS_PATHS.CLAUDE_DIR, FS_PATHS.PLANS_DIR);
  }

  /** @inheritdoc */
  resolveFromPrompt(firstPromptText: string): string {
    return extractSessionName(firstPromptText);
  }

  /** @inheritdoc */
  async resolveFromPlanFile(slug: string): Promise<string | undefined> {
    const filePath = path.join(this.plansDir, `${slug}.md`);
    try {
      const fd = await fs.promises.open(filePath, 'r');
      try {
        const buf = Buffer.alloc(512);
        const { bytesRead } = await fd.read(buf, 0, 512, 0);
        const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0];
        return extractPlanTitle(firstLine);
      } finally {
        await fd.close();
      }
    } catch {
      return undefined;
    }
  }

  /** @inheritdoc */
  isPlanFilePath(filePath: string, slug: string): boolean {
    const fileName = path.basename(filePath);
    return fileName === `${slug}.md`;
  }
}
