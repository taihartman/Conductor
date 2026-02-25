import { TRUNCATION } from '../constants';

/** Function that extracts a short description from a tool's input object. */
export type ToolSummarizer = (input: Record<string, unknown>) => string;

/** Registry mapping tool names to their input summarization functions. */
export const TOOL_SUMMARIZERS: Record<string, ToolSummarizer> = {
  Read: (input) => String(input.file_path || ''),
  Write: (input) => String(input.file_path || ''),
  Edit: (input) => String(input.file_path || ''),
  Bash: (input) => String(input.command || '').substring(0, TRUNCATION.BASH_COMMAND_MAX),
  Glob: (input) => String(input.pattern || ''),
  Grep: (input) => `${input.pattern || ''} ${input.path || ''}`.trim(),
  Task: (input) => String(input.description || ''),
  WebSearch: (input) => String(input.query || ''),
  WebFetch: (input) => String(input.url || '').substring(0, TRUNCATION.URL_MAX),
};

/**
 * Produce a short summary string for a tool call's input.
 *
 * @param toolName - Name of the tool (e.g. `'Read'`, `'Bash'`)
 * @param input - Raw input object from the tool_use block
 * @returns A human-readable summary, or empty string if no summarizer exists
 */
export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const summarizer = TOOL_SUMMARIZERS[toolName];
  return summarizer ? summarizer(input) : '';
}
