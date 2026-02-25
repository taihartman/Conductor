import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectScanner } from '../monitoring/ProjectScanner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectScanner.scanSessionFiles maxAgeMs', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
    projectDir = path.join(tmpDir, 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSessionFile(name: string, ageMs: number): void {
    const filePath = path.join(projectDir, `${name}.jsonl`);
    fs.writeFileSync(filePath, '{"type":"user"}\n');
    const mtime = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, mtime, mtime);
  }

  it('returns all files when maxAgeMs is undefined', () => {
    createSessionFile('recent', 1000);
    createSessionFile('old', 48 * 60 * 60 * 1000);

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles();

    expect(files).toHaveLength(2);
  });

  it('excludes files older than maxAgeMs', () => {
    createSessionFile('recent', 1000);
    createSessionFile('old', 48 * 60 * 60 * 1000);

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles(undefined, 24 * 60 * 60 * 1000);

    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe('recent');
  });

  it('returns empty array when all files are older than maxAgeMs', () => {
    createSessionFile('old1', 48 * 60 * 60 * 1000);
    createSessionFile('old2', 72 * 60 * 60 * 1000);

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles(undefined, 24 * 60 * 60 * 1000);

    expect(files).toHaveLength(0);
  });

  it('includes files exactly at the age boundary', () => {
    createSessionFile('borderline', 0);

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles(undefined, 1000);

    expect(files).toHaveLength(1);
  });
});
