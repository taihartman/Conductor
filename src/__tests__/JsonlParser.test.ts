import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonlParser } from '../monitoring/JsonlParser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('JsonlParser', () => {
  describe('parseString', () => {
    it('parses valid JSONL lines', () => {
      const content = [
        '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}',
        '{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg1","type":"message","role":"assistant","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}}',
      ].join('\n');

      const records = JsonlParser.parseString(content);
      expect(records).toHaveLength(2);
      expect(records[0].type).toBe('user');
      expect(records[1].type).toBe('assistant');
    });

    it('skips empty lines', () => {
      const content =
        '{"type":"user","message":{"role":"user","content":[]}}\n\n\n{"type":"assistant","message":{"model":"test","id":"1","type":"message","role":"assistant","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}';
      const records = JsonlParser.parseString(content);
      expect(records).toHaveLength(2);
    });

    it('skips malformed JSON lines', () => {
      const content =
        '{"type":"user","message":{"role":"user","content":[]}}\n{invalid json\n{"type":"system","subtype":"turn_duration"}';
      const records = JsonlParser.parseString(content);
      expect(records).toHaveLength(2);
    });

    it('skips lines without type field', () => {
      const content = '{"foo":"bar"}\n{"type":"user","message":{"role":"user","content":[]}}';
      const records = JsonlParser.parseString(content);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('user');
    });

    it('handles all 7 record types', () => {
      const lines = [
        '{"type":"user","message":{"role":"user","content":[]}}',
        '{"type":"assistant","message":{"model":"test","id":"1","type":"message","role":"assistant","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}',
        '{"type":"system","subtype":"turn_duration","durationMs":5000}',
        '{"type":"progress","data":{"type":"agent_progress"}}',
        '{"type":"summary","summary":"test summary"}',
        '{"type":"queue-operation","operation":"dequeue"}',
        '{"type":"file-history-snapshot","snapshot":{}}',
      ];
      const records = JsonlParser.parseString(lines.join('\n'));
      expect(records).toHaveLength(7);
      expect(records.map((r) => r.type)).toEqual([
        'user',
        'assistant',
        'system',
        'progress',
        'summary',
        'queue-operation',
        'file-history-snapshot',
      ]);
    });
  });

  describe('parseIncremental', () => {
    let parser: JsonlParser;
    let tmpFile: string;

    beforeEach(() => {
      parser = new JsonlParser();
      tmpFile = path.join(
        os.tmpdir(),
        `jsonl-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
      );
    });

    it('reads from byte offset', () => {
      const line1 = '{"type":"user","message":{"role":"user","content":[]}}\n';
      const line2 = '{"type":"system","subtype":"turn_duration"}\n';
      fs.writeFileSync(tmpFile, line1 + line2);

      // Read first chunk
      const result1 = parser.parseIncremental(tmpFile, 0);
      expect(result1.records).toHaveLength(2);
      expect(result1.newOffset).toBe(Buffer.byteLength(line1 + line2));

      // No new data
      const result2 = parser.parseIncremental(tmpFile, result1.newOffset);
      expect(result2.records).toHaveLength(0);

      // Append new data
      const line3 = '{"type":"summary","summary":"done"}\n';
      fs.appendFileSync(tmpFile, line3);

      const result3 = parser.parseIncremental(tmpFile, result2.newOffset);
      expect(result3.records).toHaveLength(1);
      expect(result3.records[0].type).toBe('summary');

      fs.unlinkSync(tmpFile);
    });

    it('handles partial writes with line buffering', () => {
      // Write a partial line
      const partial = '{"type":"user","message":{"role":"user","conte';
      fs.writeFileSync(tmpFile, partial);

      const result1 = parser.parseIncremental(tmpFile, 0);
      expect(result1.records).toHaveLength(0);
      expect(parser.getBufferedContent()).toBe(partial);

      // Complete the line
      const rest = 'nt":[]}}\n';
      fs.appendFileSync(tmpFile, rest);

      const result2 = parser.parseIncremental(tmpFile, result1.newOffset);
      expect(result2.records).toHaveLength(1);
      expect(result2.records[0].type).toBe('user');

      fs.unlinkSync(tmpFile);
    });

    it('returns empty for non-existent file', () => {
      const result = parser.parseIncremental('/nonexistent/file.jsonl', 0);
      expect(result.records).toHaveLength(0);
      expect(result.newOffset).toBe(0);
    });

    it('handles empty file', () => {
      fs.writeFileSync(tmpFile, '');
      const result = parser.parseIncremental(tmpFile, 0);
      expect(result.records).toHaveLength(0);
      fs.unlinkSync(tmpFile);
    });
  });

  describe('parseString with fixture file', () => {
    it('parses the sample session fixture', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'sample-session.jsonl');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const records = JsonlParser.parseString(content);

      expect(records.length).toBeGreaterThanOrEqual(7);

      const types = records.map((r) => r.type);
      expect(types).toContain('user');
      expect(types).toContain('assistant');
      expect(types).toContain('system');
      expect(types).toContain('summary');
      expect(types).toContain('file-history-snapshot');
    });
  });

  describe('peekFileMetadata', () => {
    let tmpFile: string;

    beforeEach(() => {
      tmpFile = path.join(
        os.tmpdir(),
        `peek-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
      );
    });

    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // File may not have been created
      }
    });

    it('extracts slug, cwd, and gitBranch from first record', () => {
      const line =
        '{"type":"user","slug":"my-project","cwd":"/home/user/project","gitBranch":"main","message":{"role":"user","content":[]}}\n';
      fs.writeFileSync(tmpFile, line);

      const result = JsonlParser.peekFileMetadata(tmpFile);
      expect(result.slug).toBe('my-project');
      expect(result.cwd).toBe('/home/user/project');
      expect(result.gitBranch).toBe('main');
    });

    it('returns empty metadata for empty file', () => {
      fs.writeFileSync(tmpFile, '');

      const result = JsonlParser.peekFileMetadata(tmpFile);
      expect(result).toEqual({});
    });

    it('returns empty metadata for nonexistent file', () => {
      const result = JsonlParser.peekFileMetadata('/nonexistent/path/file.jsonl');
      expect(result).toEqual({});
    });

    it('skips records without slug and finds slug in a later record', () => {
      const lines = [
        '{"type":"system","subtype":"init"}\n',
        '{"type":"user","slug":"late-slug","cwd":"/work","message":{"role":"user","content":[]}}\n',
      ].join('');
      fs.writeFileSync(tmpFile, lines);

      const result = JsonlParser.peekFileMetadata(tmpFile);
      expect(result.slug).toBe('late-slug');
      expect(result.cwd).toBe('/work');
    });

    it('handles malformed and partial JSON gracefully', () => {
      const lines = ['{invalid json\n', '{"type":"user","slug":"ok"}\n'].join('');
      fs.writeFileSync(tmpFile, lines);

      const result = JsonlParser.peekFileMetadata(tmpFile);
      expect(result.slug).toBe('ok');
    });
  });
});
