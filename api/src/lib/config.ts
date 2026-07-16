/**
 * Typed, validated runtime configuration for @asp/api.
 *
 * This is ONE of the three approved readers of `process.env` in the api
 * package (the others being `src/db/index.ts` and `drizzle.config.ts`, which
 * arrive in later stories). Every other module imports the typed `config`
 * object exported below.
 *
 * The schema is parsed at module load time. If validation fails the module
 * throws `ConfigError` — by design — so a misconfigured process exits non-zero
 * before it can serve any traffic.
 *
 * Secrets policy: the raw value of any secret env var MUST NOT appear in any
 * error message we emit. `summariseZodError` derives the human-readable error
 * string from `issue.path` and a fixed reason derived from `issue.code` only —
 * never from `issue.message`, which Zod may use to echo the submitted value.
 *
 * MFA non-negotiable: a top-level `superRefine` rejects `MFA_ENABLED=false`
 * when `NODE_ENV === 'production'`. The structural mandate exists here in
 * Phase 1, before Better Auth is wired in Phase 2, so a fork cannot run
 * production with mandatory MFA disabled.
 */

import { z } from 'zod';
import { ConfigError } from './errors.js';

/**
 * Canonical-form an `ALLOWED_ORIGINS` entry URL:
 *   - drop the default port for the scheme (http:80, https:443)
 *   - drop a lone trailing slash on the pathname (i.e. when path is `/`)
 *
 * Both `http://localhost:6051/` and `http://localhost:6051` resolve to the
 * same canonical entry in the exported `config.ALLOWED_ORIGINS` array.
 */
function isValidUrl(raw: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}

function canonicaliseOrigin(raw: string): string {
  const u = new URL(raw);
  if (
    (u.protocol === 'http:' && u.port === '80') ||
    (u.protocol === 'https:' && u.port === '443')
  ) {
    u.port = '';
  }
  // URL pathname is at least '/'. Strip a sole trailing slash so the origin
  // string canonicalises to `<scheme>://<host>[:<port>]` without a path.
  let serialised = u.toString();
  if (u.pathname === '/' && serialised.endsWith('/')) {
    serialised = serialised.slice(0, -1);
  }
  return serialised;
}

/**
 * `z.coerce.boolean()` in Zod 4 treats any truthy value (including the literal
 * string `'false'`) as `true`, which is the wrong default for a feature flag
 * that defaults open. We instead require the explicit strings `'true'` or
 * `'false'` and convert ourselves.
 */
const mfaBoolean = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

/**
 * Safe boolean for opt-in feature flags (default false).
 *
 * Accepts 'true' and 'false' as canonical values. Also maps the empty string
 * and '0' to false so that defensive operator patterns like UAT=false or UAT=0
 * behave as intended. z.coerce.boolean() is intentionally NOT used here — it
 * converts any non-empty string (including 'false') to true, which is the
 * footgun this helper exists to prevent.
 *
 * undefined/empty string/'0'/'false' → false
 * '1'/'true' → true
 * Any other value → Zod enum rejection (config startup error)
 */
const optInBoolean = z.preprocess(
  (v) => {
    if (v === undefined || v === '' || v === 'false' || v === '0') return 'false';
    if (v === 'true' || v === '1') return 'true';
    return v; // let enum validation reject other values
  },
  z.enum(['true', 'false']).transform((v) => v === 'true'),
);

const envSchema = z
  .object({
    SESSION_SECRET: z
      .string()
      .min(64, 'SESSION_SECRET must be ≥64 characters'),
    // Comma-separated list of allowed CORS origins. A single URL (no comma)
    // parses to a one-element array. Each entry is trimmed; empty entries are
    // dropped. The legacy singular `ALLOWED_ORIGIN` is read as a fallback (see
    // the preprocess below) so existing deployments do not break — deprecated.
    // Per-entry URL validity and the "at least one entry" invariant are
    // enforced in the top-level superRefine (canonicalisation happens there
    // too so invalid entries are reported rather than throwing in transform).
    ALLOWED_ORIGINS: z.preprocess(
      (v) => {
        // Fall back to the legacy ALLOWED_ORIGIN env var when ALLOWED_ORIGINS
        // is unset. process.env access is confined to this config module.
        const raw = v ?? process.env['ALLOWED_ORIGIN'];
        return raw;
      },
      z
        .string({ error: 'ALLOWED_ORIGINS is required' })
        .transform((s) =>
          s
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            // Canonicalise valid entries (drop default ports / trailing slash);
            // leave invalid entries untouched so the superRefine can report them.
            .map((entry) => (isValidUrl(entry) ? canonicaliseOrigin(entry) : entry)),
        ),
    ),
    PORT: z.coerce
      .number()
      .int()
      .min(6050, 'PORT must be in the Corral Talent dev range 6050–6059')
      .max(6059, 'PORT must be in the Corral Talent dev range 6050–6059')
      .default(6050),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    MFA_ENABLED: mfaBoolean,
    MFA_GRACE_HOURS: z.coerce.number().int().min(0).default(24),
    DATABASE_URL: z.string().url(),
    // Empty string is treated as "not provided" — allows the unit Vitest project
    // to explicitly null out DATABASE_URL_TEST from the shell env by setting it
    // to '' in the workspace env block.
    DATABASE_URL_TEST: z
      .string()
      .optional()
      .transform((v) => (v === '' ? undefined : v))
      .pipe(z.string().url().optional()),
    // Absolute path to the built UI dist directory. When set, the API serves
    // the SPA from this directory (single-origin production deployment).
    // When unset the API is API-only (dev mode, where Vite serves the UI).
    STATIC_UI_ROOT: z.string().optional(),
    // Per-endpoint rate limiting. RATE_LIMIT_WINDOW_MS is the shared window
    // (default 60 000 ms). The three MAX vars set per-group request caps:
    //
    //   RATE_LIMIT_MAX_AUTH — /api/auth/sign-in, /api/auth/sign-up,
    //                         /api/auth/request-password-reset, /api/auth/reset-password
    //   RATE_LIMIT_MAX_MFA  — /api/auth/two-factor/verify-totp
    //   RATE_LIMIT_MAX_API  — /api/experiences, /api/mentor-grants/requests
    //
    // All three default to sane values and are optional so existing deployments
    // that do not set them continue to work at the defaults.
    RATE_LIMIT_MAX_AUTH: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_MAX_MFA: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_MAX_API: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
    // Mailer provider selection. 'console' (default) logs to stdout only.
    // 'resend' wires the Resend adapter (INFRA-020/021).
    MAILER_PROVIDER: z.enum(['console', 'resend']).default('console'),
    // The sender address used in outbound email. Required when MAILER_PROVIDER
    // is not 'console'. Added to SECRET_KEYS to prevent leaking email addresses
    // in startup error logs.
    MAILER_FROM: z.string().email().optional(),
    // API key for the Resend email delivery service. Required when
    // MAILER_PROVIDER='resend'.
    RESEND_API_KEY: z.string().optional(),
    // S3-compatible object storage. Optional in dev — the StorageClient is only
    // constructed on first use (lazy init), so a missing bucket/region does not
    // prevent the API from booting when no upload route is called.
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    // UAT mode — when true, the GET /api/uat/reset-links endpoint is registered.
    // Must NOT be enabled in production. Default false.
    // Safe pattern: 'false' and '0' both produce config.UAT === false. z.coerce.boolean()
    // is NOT used because it coerces any non-empty string (including 'false') to true.
    UAT: optInBoolean,
    // Session lifetime in hours. Default 168 = 7 days, matching the Better Auth
    // built-in default. Operators requiring shorter sessions (e.g. 8h in a
    // healthcare context) can override without a code change.
    SESSION_DURATION_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(168),
  })
  .superRefine((val, ctx) => {
    // ALLOWED_ORIGINS must contain at least one entry, and every entry must be
    // a valid URL. The field transform has already split/trimmed/canonicalised;
    // invalid entries are left verbatim for this check to flag.
    if (val.ALLOWED_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'ALLOWED_ORIGINS must contain at least one origin URL',
      });
    }
    for (const origin of val.ALLOWED_ORIGINS) {
      if (!isValidUrl(origin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOWED_ORIGINS'],
          message: 'ALLOWED_ORIGINS must be a comma-separated list of valid URLs',
        });
      }
    }
    if (val.NODE_ENV === 'production' && val.MFA_ENABLED === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_ENABLED'],
        message:
          'MFA_ENABLED must be true in production — mandatory MFA is non-negotiable per ideology',
      });
    }
    // DATABASE_URL_TEST is required when NODE_ENV=test AND the process is not
    // running as a unit-test-only vitest invocation. The integration Vitest
    // project (wired in TEST-001) will provide a real service-container URL;
    // the unit Vitest project omits it. We gate the requirement on the absence
    // of the VITEST environment variable (set automatically by vitest) so that
    // `pnpm test` (unit suite) does not fail config validation while still
    // enforcing the constraint in deployment and integration runs.
    if (val.NODE_ENV === 'test' && !val.DATABASE_URL_TEST && !process.env['VITEST']) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL_TEST'],
        message:
          'DATABASE_URL_TEST is required when NODE_ENV=test (outside of unit test runs)',
      });
    }
    // Mailer production guard: console provider is not permitted in real production
    // runtimes; CI=true relaxes this so the production image can run the E2E
    // suite without a live mailer.
    if (val.NODE_ENV === 'production' && val.MAILER_PROVIDER === 'console' && process.env['CI'] !== 'true') {
      ctx.addIssue({
        code: 'custom',
        message: 'MAILER_PROVIDER=console is not permitted in production',
        path: ['MAILER_PROVIDER'],
      });
    }
    // MAILER_FROM is required when MAILER_PROVIDER is not 'console'.
    if (val.MAILER_PROVIDER !== 'console' && !val.MAILER_FROM) {
      ctx.addIssue({
        code: 'custom',
        message: 'MAILER_FROM is required when MAILER_PROVIDER is not console',
        path: ['MAILER_FROM'],
      });
    }
    // RESEND_API_KEY is required when MAILER_PROVIDER is 'resend'.
    if (val.MAILER_PROVIDER === 'resend' && !val.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'RESEND_API_KEY is required when MAILER_PROVIDER is resend',
        path: ['RESEND_API_KEY'],
      });
    }
    // UAT production guard: UAT mode must never be enabled in production.
    // A single UAT=true in production env exposes unauthenticated reset-token
    // endpoints, enabling account takeover.
    if (val.UAT === true && val.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        message: 'UAT mode must not be enabled in production (NODE_ENV=production)',
        path: ['UAT'],
      });
    }
  });

export type Config = z.infer<typeof envSchema>;

/**
 * Map a Zod issue code to a fixed, non-value-leaking reason string.
 *
 * Using `issue.code` exclusively (never `issue.message`) means the emitted
 * error can never echo back a submitted secret value regardless of what Zod
 * chooses to include in its default message for a given issue type.
 */
function issueReason(code: z.ZodIssue['code']): string {
  switch (code) {
    case 'too_small':
      return 'value too short or too small';
    case 'too_big':
      return 'value too long or too large';
    case 'invalid_type':
      return 'wrong type';
    case 'invalid_format':
      return 'invalid string format';
    case 'invalid_value':
      return 'invalid value (not one of the allowed options)';
    case 'invalid_union':
      return 'does not match any allowed variant';
    case 'custom':
      return 'failed validation rule';
    default:
      return 'invalid value';
  }
}

function summariseZodError(err: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of err.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    // Reason is derived from issue.code only — never issue.message.
    // This guarantees that no submitted secret value can appear in the output,
    // regardless of what Zod embeds in its default message.
    const reason = issueReason(issue.code);
    lines.push(`  - ${path}: ${reason}`);
  }
  return `Invalid environment configuration:\n${lines.join('\n')}`;
}

const result = envSchema.safeParse(process.env);
if (!result.success) {
  throw new ConfigError(summariseZodError(result.error));
}

export const config: Config = result.data;
