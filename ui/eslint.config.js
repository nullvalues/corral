// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat ESLint config for @asp/ui.
 *
 * Phase 1 keeps this intentionally minimal: typescript-eslint recommended +
 * react-hooks recommended. The structural "no hex literals in component source"
 * rule arrives in Phase 3 (UI-003) — until then, hex-literal enforcement is
 * reviewer-only and a TODO comment in `src/App.tsx` documents the gap.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#([0-9a-fA-F]{3,8})$/]',
          message: 'Use Tailwind theme tokens — no hex literals in component files',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
