import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionNameResolver } from '../persistence/SessionNameResolver';

describe('SessionNameResolver', () => {
  let tmpDir: string;
  let resolver: SessionNameResolver;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-test-'));
    resolver = new SessionNameResolver(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveFromPrompt', () => {
    it('delegates to extractSessionName correctly', () => {
      expect(resolver.resolveFromPrompt('Fix the login bug')).toBe('Fix the login bug');
    });

    it('extracts first sentence from long text', () => {
      expect(resolver.resolveFromPrompt('Fix the login bug. Also update tests.')).toBe(
        'Fix the login bug.'
      );
    });
  });

  describe('resolveFromPlanFile', () => {
    it('returns title from existing plan file', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'cool-slug.md'),
        '# Plan: Fix Activity Feed Eviction\n\nContent here'
      );
      const result = await resolver.resolveFromPlanFile('cool-slug');
      expect(result).toBe('Fix Activity Feed Eviction');
    });

    it('returns undefined for missing file', async () => {
      const result = await resolver.resolveFromPlanFile('nonexistent-slug');
      expect(result).toBeUndefined();
    });

    it('returns undefined for file without H1', async () => {
      fs.writeFileSync(path.join(tmpDir, 'no-heading.md'), 'Just some text without a heading');
      const result = await resolver.resolveFromPlanFile('no-heading');
      expect(result).toBeUndefined();
    });

    it('handles plan file with only H1 prefix', async () => {
      fs.writeFileSync(path.join(tmpDir, 'empty-plan.md'), '# Plan:\n\nContent');
      const result = await resolver.resolveFromPlanFile('empty-plan');
      expect(result).toBeUndefined();
    });
  });

  describe('isPlanFilePath', () => {
    it('matches correct slug pattern', () => {
      expect(resolver.isPlanFilePath('/home/user/.claude/plans/my-slug.md', 'my-slug')).toBe(true);
    });

    it('rejects non-matching slug', () => {
      expect(resolver.isPlanFilePath('/home/user/.claude/plans/other-slug.md', 'my-slug')).toBe(
        false
      );
    });

    it('rejects non-.md files', () => {
      expect(resolver.isPlanFilePath('/home/user/.claude/plans/my-slug.txt', 'my-slug')).toBe(
        false
      );
    });

    it('matches regardless of directory path', () => {
      expect(resolver.isPlanFilePath('/any/path/to/my-slug.md', 'my-slug')).toBe(true);
    });
  });

  describe('custom plansDir', () => {
    it('uses provided plansDir for file resolution', async () => {
      const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-plans-'));
      const customResolver = new SessionNameResolver(customDir);
      fs.writeFileSync(path.join(customDir, 'test-slug.md'), '# Custom Plan Title\n');
      const result = await customResolver.resolveFromPlanFile('test-slug');
      expect(result).toBe('Custom Plan Title');
      fs.rmSync(customDir, { recursive: true, force: true });
    });
  });
});
