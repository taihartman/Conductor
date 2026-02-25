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

describe('ProjectScanner subdirectory scanning', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-subdir-'));
    projectDir = path.join(tmpDir, 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers files in */subagents/ subdirectories', () => {
    // Create parent session file
    const parentFile = path.join(projectDir, 'parent-uuid-123.jsonl');
    fs.writeFileSync(parentFile, '{"type":"user"}\n');

    // Create subagents directory and agent file
    const subagentsDir = path.join(projectDir, 'parent-uuid-123', 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });
    const agentFile = path.join(subagentsDir, 'agent-abc.jsonl');
    fs.writeFileSync(agentFile, '{"type":"user"}\n');

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles();

    expect(files).toHaveLength(2);
    const agentSession = files.find((f) => f.sessionId === 'agent-abc');
    expect(agentSession).toBeDefined();
    expect(agentSession!.isSubAgent).toBe(true);
    expect(agentSession!.parentSessionId).toBe('parent-uuid-123');
  });

  it('sets parentSessionId correctly from directory structure', () => {
    const parentUuid = 'session-uuid-456';
    const subagentsDir = path.join(projectDir, parentUuid, 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });

    const agentFile = path.join(subagentsDir, 'agent-def.jsonl');
    fs.writeFileSync(agentFile, '{"type":"user"}\n');

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles();

    expect(files).toHaveLength(1);
    expect(files[0].parentSessionId).toBe(parentUuid);
    expect(files[0].projectDir).toBe('test-project');
  });

  it('handles missing subagents directory gracefully', () => {
    // Create a directory without subagents/
    const sessionDir = path.join(projectDir, 'some-uuid');
    fs.mkdirSync(sessionDir, { recursive: true });

    // Create a regular file in the project dir
    const sessionFile = path.join(projectDir, 'some-session.jsonl');
    fs.writeFileSync(sessionFile, '{"type":"user"}\n');

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles();

    // Should only find the root-level session file
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe('some-session');
  });

  it('root-level agent files have no parentSessionId', () => {
    const agentFile = path.join(projectDir, 'agent-root.jsonl');
    fs.writeFileSync(agentFile, '{"type":"user"}\n');

    const scanner = new ProjectScanner(tmpDir);
    const files = scanner.scanSessionFiles();

    expect(files).toHaveLength(1);
    expect(files[0].isSubAgent).toBe(true);
    expect(files[0].parentSessionId).toBeUndefined();
  });
});
