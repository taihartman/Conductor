import { vi } from 'vitest';

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  joinPath: (base: any, ...segments: string[]) => ({
    fsPath: [base.fsPath, ...segments].join('/'),
    scheme: 'file',
    path: [base.path, ...segments].join('/'),
  }),
};

export const workspace = {
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: () => {} })),
};

export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    dispose: () => {},
  }),
  showQuickPick: vi.fn(),
};

/** Mirrors the VS Code QuickPickItemKind enum. Separator = -1. */
export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export class RelativePattern {
  constructor(
    public base: any,
    public pattern: string
  ) {}
}

export class EventEmitter {
  private listeners: Function[] = [];
  event = (listener: Function) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(data: any) {
    this.listeners.forEach((l) => l(data));
  }
  dispose() {
    this.listeners = [];
  }
}
