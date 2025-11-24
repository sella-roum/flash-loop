import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // 無視するファイル/ディレクトリ
  { ignores: ['dist', 'node_modules', 'generated.spec.ts', 'test-results', 'playwright-report'] },

  // 基本設定
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Playwright 設定
  {
    ...playwright.configs['flat/recommended'],
    // テストファイルだけでなく、src内のファイルでもPlaywrightのルールを適用したい場合はここを調整
    // 現状のプロジェクト構成に合わせて全tsファイルに適用、または必要なファイルのみに絞る
    files: ['**/*.ts'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-networkidle': 'off',
    },
  },

  // Prettier と競合するルールを無効化
  prettier,

  // カスタムルール
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  }
);
