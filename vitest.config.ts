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
      '@shared': path.resolve(__dirname, 'src/models'),
      // Unify React resolution so vi.mock('react') intercepts webview-ui's imports too
      react: path.resolve(__dirname, 'webview-ui/node_modules/react'),
    },
  },
});
