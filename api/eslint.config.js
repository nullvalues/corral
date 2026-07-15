// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for @asp/api.
 *
 * The headline rule is `no-process-env`: only three files in the api package
 * are allowed to read `process.env` —
 *   - `src/lib/config.ts`     (the typed config layer)
 *   - `src/db/index.ts`       (Drizzle pool; arrives in Phase 2)
 *   - `drizzle.config.ts`     (drizzle-kit CLI config; arrives in Phase 2)
 *
 * Every other source file imports the typed `config` object from
 * `./lib/config.js` instead of touching `process.env` directly. This is the
 * "process.env containment" rule from `docs/brief.md`.
 *
 * Test files are EXEMPT: tests routinely stub env per-case (see INFRA-004's
 * tests of the config gates), and forcing them through the typed config layer
 * would defeat their purpose. The Phase 4 structural-layer test tightens this
 * further if needed.
 *
 * The second rule — `no-restricted-imports` on external SDKs — enforces the
 * single-seam pattern (INFRA-005): only `src/lib/storage.ts` may import
 * `@aws-sdk/*`, and only `src/lib/ai.ts` may import `@anthropic-ai/sdk`.
 * Route handlers, services, and agents must depend on the `StorageClient` /
 * `AiClient` interfaces, never the underlying SDKs directly. The rule is
 * armed now (Phase 1) even though the SDK packages aren't installed yet, so
 * any future stories that pull them in are bounded to the seam files from
 * the moment they land.
 */
const NO_PROCESS_ENV = {
  selector:
    'MemberExpression[object.name="process"][property.name="env"]',
  message:
    'process.env is only readable in src/lib/config.ts, src/db/index.ts, and drizzle.config.ts. Import the typed `config` object instead.',
};

const SDK_IMPORT_DENY = {
  patterns: [
    {
      group: ['@aws-sdk', '@aws-sdk/*'],
      message:
        'Direct @aws-sdk imports are only permitted in src/lib/storage.ts. Depend on the StorageClient interface (fastify.storageClient) instead.',
    },
    {
      group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*'],
      message:
        'Direct @anthropic-ai/sdk imports are only permitted in src/lib/ai.ts. Depend on the AiClient interface (fastify.aiClient) instead.',
    },
    {
      group: ['resend', 'resend/*'],
      message:
        'Direct resend imports are only permitted in src/lib/mailerAdapters/resend.ts. Depend on the MailerClient interface (fastify.mailer) instead.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', NO_PROCESS_ENV],
      // Allow underscore-prefixed unused params: the seam stubs in
      // src/lib/{storage,ai}.ts intentionally accept arguments they don't
      // use until real SDK implementations land in later phases.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Single-seam containment: block direct SDK imports from routes/services/agents.
  // Only the seam files (src/lib/storage.ts, src/lib/ai.ts) may import them.
  {
    files: [
      'src/routes/**/*.ts',
      'src/services/**/*.ts',
      'src/agents/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', SDK_IMPORT_DENY],
    },
  },
  // Approved process.env readers — disable the restriction for these files.
  {
    files: [
      'src/lib/config.ts',
      'src/db/index.ts',
      'drizzle.config.ts',
      'src/scripts/**',
      'src/db/seed.uat.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Tests stub env per-case; the restriction does not apply.
  {
    files: [
      '**/*.test.ts',
      '**/*.integration.test.ts',
      'tests/**',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
