import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Domain layer: no DOM, no React, no Chrome, no SDK imports
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'react',
            'react-dom',
            'chrome',
            'dexie',
            'idb',
            'wxt/storage',
            'ai',
            '@ai-sdk/openai-compatible',
            'minisearch',
            'ts-fsrs',
          ],
        },
      ],
    },
  },
  {
    // Content script: no credentials, no direct DB
    files: ['src/content-ui/**/*.{ts,tsx}', 'entrypoints/content.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            '@infra/storage/credentials',
            'dexie',
          ],
        },
      ],
    },
  },
  {
    // Entrypoint files export config objects, not React components
    files: ['entrypoints/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  globalIgnores([
    'node_modules/**',
    '.output/**',
    '.wxt/**',
    'artifacts/**',
    'dist/**',
    'coverage/**',
    '*.min.js',
  ]),
]);
