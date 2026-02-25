import { TRUNCATION } from '../constants';

export type ToolSummarizer = (input: Record<string, unknown>) => string;

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

export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const summarizer = TOOL_SUMMARIZERS[toolName];
  return summarizer ? summarizer(input) : '';
}
