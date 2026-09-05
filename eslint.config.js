import eslint from '@eslint/js';
import globals from 'globals';
import unusedImports from 'eslint-plugin-unused-imports';

const unusedCodeRules = {
  'no-unused-vars': 'off',
  'unused-imports/no-unused-imports': 'warn',
  'unused-imports/no-unused-vars': [
    'warn',
    {
      vars: 'all',
      varsIgnorePattern: '^_',
      args: 'after-used',
      argsIgnorePattern: '^_',
      caughtErrors: 'none',
      ignoreRestSiblings: true,
    },
  ],
};

export default [
  {
    ignores: ['dist/**', 'downloaded/**', 'models/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: unusedCodeRules,
  },
  {
    files: ['vite.config.js', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: unusedCodeRules,
  },
];
