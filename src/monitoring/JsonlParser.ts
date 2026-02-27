/**
 * @module JsonlParser
 *
 * Incremental JSONL parser for Claude Code transcript files.
 *
 * @remarks
 * Designed for efficient tailing of growing files. Tracks a byte offset
 * so only new data is read on each poll. A line buffer handles partial
 * lines at read boundaries (e.g., when a write is in progress).
 */

import * as fs from 'fs';
import { JsonlRecord } from '../models/types';
import { FILE_PEEK } from '../constants';

/** Metadata eagerly extracted from the first few bytes of a JSONL file. */
export interface PeekedMetadata {
  /** Session slug (short project identifier). */
  slug?: string;
  /** Working directory recorded in the JSONL record. */
  cwd?: string;
  /** Git branch recorded in the JSONL record. */
  gitBranch?: string;
}

/** Result of an incremental parse operation. */
export interface ParseResult {
  /** Successfully parsed JSONL records. */
  records: JsonlRecord[];
  /** Number of bytes actually read from disk. */
  bytesRead: number;
  /** Updated byte offset for the next read (pass back to {@link JsonlParser.parseIncremental}). */
  newOffset: number;
}

/**
 * Incremental JSONL parser with line buffering for partial reads.
 *
 * @remarks
 * Each instance maintains its own line buffer, so a separate `JsonlParser`
 * should be created per file being watched. The {@link TranscriptWatcher}
 * manages the parser-per-file mapping.
 *
 * Malformed JSON lines are silently skipped — this is intentional because
 * partial writes during active transcription may produce temporarily
 * invalid JSON that becomes valid on the next read.
 */
export class JsonlParser {
  private lineBuffer: string = '';

  /**
   * Read new bytes from a JSONL file starting at the given byte offset.
   *
   * @remarks
   * Maintains a line buffer for partial writes at read boundaries. The last
   * incomplete line (if any) is held in the buffer until the next call
   * completes it with a newline.
   *
   * @param filePath - Absolute path to the JSONL file
   * @param fromOffset - Byte offset to start reading from
   * @returns Parsed records, bytes read, and the new offset for the next call
   */
  parseIncremental(filePath: string, fromOffset: number): ParseResult {
    let fileSize: number;
    try {
      const stat = fs.statSync(filePath);
      fileSize = stat.size;
    } catch {
      return { records: [], bytesRead: 0, newOffset: fromOffset };
    }

    if (fileSize <= fromOffset) {
      return { records: [], bytesRead: 0, newOffset: fromOffset };
    }

    const bytesToRead = fileSize - fromOffset;
    const buffer = Buffer.alloc(bytesToRead);

    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      return { records: [], bytesRead: 0, newOffset: fromOffset };
    }

    let actualBytesRead: number;
    try {
      actualBytesRead = fs.readSync(fd, buffer, 0, bytesToRead, fromOffset);
    } finally {
      fs.closeSync(fd);
    }

    const chunk = buffer.toString('utf-8', 0, actualBytesRead);
    const text = this.lineBuffer + chunk;
    const lines = text.split('\n');

    // Last element might be incomplete - save it for next read
    this.lineBuffer = lines.pop() || '';

    const records: JsonlRecord[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as JsonlRecord;
        if (parsed && typeof parsed === 'object' && parsed.type) {
          records.push(parsed);
        }
      } catch {
        // Malformed JSON line - skip it
      }
    }

    return {
      records,
      bytesRead: actualBytesRead,
      newOffset: fromOffset + actualBytesRead,
    };
  }

  /**
   * Parse a complete JSONL string into records.
   *
   * @remarks
   * Stateless convenience method — does not use the instance line buffer.
   * Useful for testing or processing small, complete JSONL payloads.
   *
   * @param content - Complete JSONL string (newline-delimited JSON)
   * @returns Array of parsed records (malformed lines are silently skipped)
   */
  static parseString(content: string): JsonlRecord[] {
    const records: JsonlRecord[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as JsonlRecord;
        if (parsed && typeof parsed === 'object' && parsed.type) {
          records.push(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return records;
  }

  /**
   * Eagerly extract metadata (slug, cwd, gitBranch) from the start of a JSONL file.
   *
   * @remarks
   * Reads up to {@link FILE_PEEK.MAX_BYTES} bytes synchronously and parses
   * complete lines. Returns metadata from the first record that contains a
   * `slug` field. Returns `{}` on any error (empty file, missing file, no
   * slug found, malformed JSON).
   *
   * @param filePath - Absolute path to the JSONL file
   * @returns Extracted metadata, or empty object if unavailable
   */
  static peekFileMetadata(filePath: string): PeekedMetadata {
    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      return {};
    }

    try {
      const buffer = Buffer.alloc(FILE_PEEK.MAX_BYTES);
      const bytesRead = fs.readSync(fd, buffer, 0, FILE_PEEK.MAX_BYTES, 0);
      if (bytesRead === 0) {
        return {};
      }

      const text = buffer.toString('utf-8', 0, bytesRead);
      const lines = text.split('\n');

      // Drop the last element — it may be a partial line from the byte boundary
      if (!text.endsWith('\n')) {
        lines.pop();
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && parsed.slug) {
            const result: PeekedMetadata = { slug: parsed.slug };
            if (parsed.cwd) {
              result.cwd = parsed.cwd;
            }
            if (parsed.gitBranch) {
              result.gitBranch = parsed.gitBranch;
            }
            return result;
          }
        } catch {
          // Malformed line — skip and try next
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    return {};
  }

  /** Clear the line buffer. Call when switching files or resetting state. */
  resetBuffer(): void {
    this.lineBuffer = '';
  }

  /**
   * Returns the current contents of the line buffer (for testing/debugging).
   *
   * @returns The buffered partial line content
   */
  getBufferedContent(): string {
    return this.lineBuffer;
  }
}
