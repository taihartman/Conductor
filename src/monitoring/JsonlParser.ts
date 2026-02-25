import * as fs from 'fs';
import { JsonlRecord } from '../models/types';

export interface ParseResult {
  records: JsonlRecord[];
  bytesRead: number;
  newOffset: number;
}

export class JsonlParser {
  private lineBuffer: string = '';

  /**
   * Read new bytes from a JSONL file starting at the given byte offset.
   * Maintains a line buffer for partial writes at read boundaries.
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
   * Parse a complete JSONL string (for testing or small files).
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

  resetBuffer(): void {
    this.lineBuffer = '';
  }

  getBufferedContent(): string {
    return this.lineBuffer;
  }
}
