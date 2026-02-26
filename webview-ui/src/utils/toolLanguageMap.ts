const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.json': 'json',
  '.css': 'css',
  '.html': 'markup',
  '.htm': 'markup',
  '.xml': 'markup',
  '.svg': 'markup',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.rs': 'rust',
  '.go': 'go',
  '.diff': 'diff',
  '.patch': 'diff',
};

const TOOL_LANGUAGE_MAP: Record<string, string> = {
  Bash: 'bash',
  BashOutput: 'bash',
};

function inferFromExtension(inputSummary: string): string | undefined {
  const match = /\.(\w+)(?:\s|$|:|\))/.exec(inputSummary);
  if (!match) return undefined;
  const ext = '.' + match[1].toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext];
}

export function inferToolLanguage(toolName: string, inputSummary?: string): string {
  const directMap = TOOL_LANGUAGE_MAP[toolName];
  if (directMap) return directMap;

  if (inputSummary) {
    const fromExt = inferFromExtension(inputSummary);
    if (fromExt) return fromExt;
  }

  return 'text';
}
