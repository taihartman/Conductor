import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'webview-ui'],
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'src/__tests__/__mocks__/vscode.ts'),
    },
  },
});
