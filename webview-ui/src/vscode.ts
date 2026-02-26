interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

function getApi(): VsCodeApi {
  if (typeof acquireVsCodeApi === 'function') {
    return acquireVsCodeApi();
  }
  // Dev-mode stub: allows running in a browser outside VS Code
  let state: unknown = undefined;
  return {
    postMessage(message: unknown): void {
      console.log('[vscode-dev-stub] postMessage:', message);
    },
    getState(): unknown {
      return state;
    },
    setState(s: unknown): void {
      state = s;
    },
  };
}

class VsCodeWrapper {
  private readonly api: VsCodeApi;

  constructor() {
    this.api = getApi();
  }

  postMessage(message: unknown): void {
    this.api.postMessage(message);
  }

  getState<T>(): T | undefined {
    return this.api.getState() as T | undefined;
  }

  setState<T>(state: T): void {
    this.api.setState(state);
  }
}

export const vscode = new VsCodeWrapper();
