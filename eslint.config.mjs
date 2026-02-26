import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'webview-ui/**',
      'docs/**',
      'src/__tests__/**',
      'esbuild.js',
      'vitest.config.ts',
      '*.mjs',
      'playwright.config.ts',
      'drag-reorder.spec.ts',
      'scripts/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { jsdoc },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Project conventions from CLAUDE.md
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow unused vars prefixed with _ (common pattern in the codebase)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // TSDoc enforcement
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
          checkConstructors: false,
          checkGetters: true,
        },
      ],
      'jsdoc/require-param': 'warn',
      'jsdoc/require-returns': ['warn', { forceRequireReturn: false }],
      'jsdoc/check-param-names': 'warn',
    },
  }
);
