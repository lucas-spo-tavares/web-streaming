import js from '@eslint/js';
import ts from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
export default ts.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/components/ui/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['front/src/**/*.{ts,tsx}'],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['return', 'function', 'try', 'if', 'export'] },
      ],
    },
  },
);
