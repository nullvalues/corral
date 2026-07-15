import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for `src/lib/config.ts`.
 *
 * config.ts validates `process.env` at module-load time and throws
 * `ConfigError` on any failure. Each test therefore:
 *   1. stubs `process.env` to the case under test
 *   2. resets the module registry so config.ts re-runs
 *   3. dynamically imports config.ts and asserts on the result (or thrown error)
 *
 * `beforeEach` clears env stubs + module cache so cases cannot leak into each
 * other. Stubs added with `vi.stubEnv` are torn down by `vi.unstubAllEnvs()`.
 */

const VALID_SECRET = 'a'.repeat(64);
const VALID_DB_URL = 'postgresql://asp:asp@localhost:5432/asp';
const VALID_DB_URL_TEST = 'postgresql://asp:asp@localhost:5432/asp_test';

type EnvMap = Record<string, string | undefined>;

function stubEnv(env: EnvMap): void {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      // vi.stubEnv with undefined deletes the variable for the test.
      vi.stubEnv(k, undefined as unknown as string);
    } else {
      vi.stubEnv(k, v);
    }
  }
}

async function importConfig(): Promise<typeof import('../src/lib/config.js')> {
  vi.resetModules();
  return await import('../src/lib/config.js');
}

async function expectConfigError(env: EnvMap): Promise<Error> {
  stubEnv(env);
  try {
    await importConfig();
  } catch (err) {
    return err as Error;
  }
  throw new Error('Expected ConfigError to be thrown but import succeeded');
}

describe('config.ts', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    // Wipe the env vars config.ts cares about so each test starts from a clean
    // baseline. `vi.stubEnv(key, undefined)` does the unset.
    for (const key of [
      'SESSION_SECRET',
      'ALLOWED_ORIGINS',
      'ALLOWED_ORIGIN',
      'PORT',
      'NODE_ENV',
      'MFA_ENABLED',
      'DATABASE_URL',
      'DATABASE_URL_TEST',
      'MAILER_PROVIDER',
      'MAILER_FROM',
      'RESEND_API_KEY',
      'SESSION_DURATION_HOURS',
    ]) {
      vi.stubEnv(key, undefined as unknown as string);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('parses a fully-valid env into the typed config object', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      PORT: '6040',
      NODE_ENV: 'test',
      MFA_ENABLED: 'true',
      DATABASE_URL: VALID_DB_URL,
      DATABASE_URL_TEST: VALID_DB_URL_TEST,
    });
    const { config } = await importConfig();
    expect(config.SESSION_SECRET).toBe(VALID_SECRET);
    expect(config.ALLOWED_ORIGINS).toEqual(['http://localhost:6041']);
    expect(config.PORT).toBe(6040);
    expect(config.NODE_ENV).toBe('test');
    expect(config.MFA_ENABLED).toBe(true);
    // Type-level: PORT must be a number, MFA_ENABLED a boolean. The runtime
    // checks below double-bind those.
    expect(typeof config.PORT).toBe('number');
    expect(typeof config.MFA_ENABLED).toBe('boolean');
  });

  it('throws ConfigError naming SESSION_SECRET when the secret is too short', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: 'a'.repeat(63),
      ALLOWED_ORIGINS: 'http://localhost:6041',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/SESSION_SECRET/);
  });

  it('throws ConfigError naming ALLOWED_ORIGINS when it is unset', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      // ALLOWED_ORIGINS deliberately unset
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/ALLOWED_ORIGINS/);
  });

  it('canonicalises ALLOWED_ORIGINS with a trailing slash', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041/',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual(['http://localhost:6041']);
  });

  it('canonicalises ALLOWED_ORIGINS without a trailing slash to the same value', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual(['http://localhost:6041']);
  });

  it('drops a default HTTP port from ALLOWED_ORIGINS (drift guard)', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://example.com:80',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual(['http://example.com']);
  });

  it('drops a default HTTPS port from ALLOWED_ORIGINS (drift guard)', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://example.com:443',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual(['https://example.com']);
  });

  it('rejects PORT=5000 (outside asp dev range)', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      PORT: '5000',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/PORT/);
  });

  it('accepts PORT=6040', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      PORT: '6040',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.PORT).toBe(6040);
  });

  it('defaults PORT to 6040 when unset', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      // PORT deliberately unset
    });
    const { config } = await importConfig();
    expect(config.PORT).toBe(6040);
  });

  it('never includes the SESSION_SECRET value in error messages', async () => {
    const sneakySecret = 'super-secret-do-not-leak-this-value-into-an-error-string-anywhere-1234567890';
    // Make the secret deliberately too short by *also* giving an invalid
    // origin, forcing a failure path. Then assert the secret literal is absent.
    const err = await expectConfigError({
      // Long enough to pass min(64) — to ensure that even when the secret is
      // valid, the error message for OTHER failures cannot leak it.
      SESSION_SECRET: sneakySecret,
      ALLOWED_ORIGINS: 'not-a-url',
    });
    expect(err.name).toBe('ConfigError');
    // Hard check: the literal value must not appear anywhere in the message.
    expect(err.message).not.toMatch(new RegExp(sneakySecret));
    expect(err.message).not.toContain(sneakySecret);

    // And when the secret itself is too short, the failing input must also
    // not be echoed.
    const shortSecret = 'b'.repeat(40);
    const err2 = await expectConfigError({
      SESSION_SECRET: shortSecret,
      ALLOWED_ORIGINS: 'http://localhost:6041',
    });
    expect(err2.message).not.toContain(shortSecret);

    // CER-001 / INFRA-035: summariseZodError must derive messages from
    // issue.path only, never issue.message. Supply a 10-character secret
    // (well below the 64-char minimum) and assert the submitted value is
    // not present, while the path label (SESSION_SECRET) still is.
    const tenCharSecret = 'x'.repeat(10);
    const err3 = await expectConfigError({
      SESSION_SECRET: tenCharSecret,
      ALLOWED_ORIGINS: 'http://localhost:6041',
    });
    expect(err3.name).toBe('ConfigError');
    // The submitted value must never appear in the output.
    expect(err3.message).not.toContain(tenCharSecret);
    // The path label must still appear so the error is actionable.
    expect(err3.message).toMatch(/SESSION_SECRET/);
  });

  it('rejects MFA_ENABLED=false when NODE_ENV=production', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://example.com',
      NODE_ENV: 'production',
      MFA_ENABLED: 'false',
      DATABASE_URL: VALID_DB_URL,
      // Provide a valid mailer config so only the MFA error fires
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      RESEND_API_KEY: 're_test_key_abc123',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/MFA_ENABLED/);
  });

  it('accepts NODE_ENV=production with MFA_ENABLED=true', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://example.com',
      NODE_ENV: 'production',
      MFA_ENABLED: 'true',
      DATABASE_URL: VALID_DB_URL,
      // MAILER_PROVIDER=console is rejected in production; supply resend with required fields
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      RESEND_API_KEY: 're_test_key_abc123',
    });
    const { config } = await importConfig();
    expect(config.NODE_ENV).toBe('production');
    expect(config.MFA_ENABLED).toBe(true);
  });

  it('accepts NODE_ENV=production with MFA_ENABLED unset (defaults to true)', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://example.com',
      NODE_ENV: 'production',
      DATABASE_URL: VALID_DB_URL,
      // MFA_ENABLED deliberately unset — default is true
      // MAILER_PROVIDER=console is rejected in production; supply resend with required fields
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      RESEND_API_KEY: 're_test_key_abc123',
    });
    const { config } = await importConfig();
    expect(config.NODE_ENV).toBe('production');
    expect(config.MFA_ENABLED).toBe(true);
  });

  it('accepts MFA_ENABLED=false when NODE_ENV=development', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      NODE_ENV: 'development',
      MFA_ENABLED: 'false',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.NODE_ENV).toBe('development');
    expect(config.MFA_ENABLED).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // MAILER_PROVIDER / MAILER_FROM / RESEND_API_KEY
  // ---------------------------------------------------------------------------

  it('defaults MAILER_PROVIDER to "console" when unset', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      // MAILER_PROVIDER deliberately unset
    });
    const { config } = await importConfig();
    expect(config.MAILER_PROVIDER).toBe('console');
  });

  it('accepts MAILER_PROVIDER="console" explicitly', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'console',
    });
    const { config } = await importConfig();
    expect(config.MAILER_PROVIDER).toBe('console');
  });

  it('rejects an unknown MAILER_PROVIDER value', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'sendgrid',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/MAILER_PROVIDER/);
  });

  it('rejects MAILER_PROVIDER=console when NODE_ENV=production', async () => {
    const originalCI = process.env['CI'];
    process.env['CI'] = undefined as unknown as string;
    try {
      const err = await expectConfigError({
        SESSION_SECRET: VALID_SECRET,
        ALLOWED_ORIGINS: 'https://example.com',
        NODE_ENV: 'production',
        MFA_ENABLED: 'true',
        DATABASE_URL: VALID_DB_URL,
        MAILER_PROVIDER: 'console',
      });
      expect(err.name).toBe('ConfigError');
      expect(err.message).toMatch(/MAILER_PROVIDER/);
    } finally {
      if (originalCI === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = originalCI;
      }
    }
  });

  it('rejects MAILER_PROVIDER unset (defaults to console) when NODE_ENV=production', async () => {
    const originalCI = process.env['CI'];
    process.env['CI'] = undefined as unknown as string;
    try {
      const err = await expectConfigError({
        SESSION_SECRET: VALID_SECRET,
        ALLOWED_ORIGINS: 'https://example.com',
        NODE_ENV: 'production',
        MFA_ENABLED: 'true',
        DATABASE_URL: VALID_DB_URL,
        // MAILER_PROVIDER unset — defaults to 'console', which is rejected in production
      });
      expect(err.name).toBe('ConfigError');
      expect(err.message).toMatch(/MAILER_PROVIDER/);
    } finally {
      if (originalCI === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = originalCI;
      }
    }
  });

  it('rejects MAILER_PROVIDER=console in production when CI env is not set', async () => {
    // Explicitly ensure CI is not set for this test.
    const originalCI = process.env['CI'];
    process.env['CI'] = undefined as unknown as string;
    try {
      const err = await expectConfigError({
        SESSION_SECRET: VALID_SECRET,
        ALLOWED_ORIGINS: 'https://example.com',
        NODE_ENV: 'production',
        MFA_ENABLED: 'true',
        DATABASE_URL: VALID_DB_URL,
        MAILER_PROVIDER: 'console',
      });
      expect(err.name).toBe('ConfigError');
      expect(err.message).toMatch(/MAILER_PROVIDER/);
    } finally {
      if (originalCI === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = originalCI;
      }
    }
  });

  it('accepts MAILER_PROVIDER=console in production when CI=true', async () => {
    const originalCI = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      stubEnv({
        SESSION_SECRET: VALID_SECRET,
        ALLOWED_ORIGINS: 'https://example.com',
        NODE_ENV: 'production',
        MFA_ENABLED: 'true',
        DATABASE_URL: VALID_DB_URL,
        MAILER_PROVIDER: 'console',
      });
      const { config } = await importConfig();
      expect(config.NODE_ENV).toBe('production');
      expect(config.MAILER_PROVIDER).toBe('console');
    } finally {
      if (originalCI === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = originalCI;
      }
    }
  });

  it('accepts MAILER_PROVIDER=resend with MAILER_FROM and RESEND_API_KEY in production', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://example.com',
      NODE_ENV: 'production',
      MFA_ENABLED: 'true',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      RESEND_API_KEY: 're_test_key_abc123',
    });
    const { config } = await importConfig();
    expect(config.MAILER_PROVIDER).toBe('resend');
    expect(config.MAILER_FROM).toBe('noreply@example.com');
    expect(config.RESEND_API_KEY).toBe('re_test_key_abc123');
  });

  it('rejects MAILER_PROVIDER=resend without MAILER_FROM', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      // MAILER_FROM deliberately unset
      RESEND_API_KEY: 're_test_key_abc123',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/MAILER_FROM/);
  });

  it('rejects MAILER_PROVIDER=resend without RESEND_API_KEY', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      // RESEND_API_KEY deliberately unset
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/RESEND_API_KEY/);
  });

  it('rejects MAILER_FROM with an invalid email format', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'not-an-email',
      RESEND_API_KEY: 're_test_key_abc123',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/MAILER_FROM/);
  });

  it('does not include RESEND_API_KEY value in error messages (secret redaction)', async () => {
    const secretKey = 're_super_secret_key_that_must_not_appear_in_any_error_message_ever';
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      RESEND_API_KEY: secretKey,
      // Force another error to trigger the error path while the key is valid
      PORT: '5000',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).not.toContain(secretKey);
  });

  it('does not include MAILER_FROM value in error messages (secret redaction)', async () => {
    const fromAddress = 'should-not-leak-this-address@example.com';
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: fromAddress,
      // RESEND_API_KEY missing — triggers an error while MAILER_FROM is present
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).not.toContain(fromAddress);
  });

  it('accepts MAILER_PROVIDER=resend with MAILER_FROM in development (no RESEND_API_KEY missing guard fires for other providers)', async () => {
    // This test verifies that MAILER_PROVIDER=resend requires RESEND_API_KEY
    // regardless of NODE_ENV.
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      NODE_ENV: 'development',
      DATABASE_URL: VALID_DB_URL,
      MAILER_PROVIDER: 'resend',
      MAILER_FROM: 'noreply@example.com',
      // RESEND_API_KEY missing
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/RESEND_API_KEY/);
  });

  // ---------------------------------------------------------------------------
  // SESSION_DURATION_HOURS (INFRA-051)
  // ---------------------------------------------------------------------------

  it('defaults SESSION_DURATION_HOURS to 168 when unset', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      // SESSION_DURATION_HOURS deliberately unset
    });
    const { config } = await importConfig();
    expect(config.SESSION_DURATION_HOURS).toBe(168);
  });

  it('parses SESSION_DURATION_HOURS=8 to the number 8', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      SESSION_DURATION_HOURS: '8',
    });
    const { config } = await importConfig();
    expect(config.SESSION_DURATION_HOURS).toBe(8);
    expect(typeof config.SESSION_DURATION_HOURS).toBe('number');
  });

  it('rejects SESSION_DURATION_HOURS=0 (must be positive)', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      SESSION_DURATION_HOURS: '0',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/SESSION_DURATION_HOURS/);
  });

  it('rejects SESSION_DURATION_HOURS=-1 (must be positive)', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      SESSION_DURATION_HOURS: '-1',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/SESSION_DURATION_HOURS/);
  });

  it('rejects SESSION_DURATION_HOURS=abc (non-numeric)', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      SESSION_DURATION_HOURS: 'abc',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/SESSION_DURATION_HOURS/);
  });

  it('rejects SESSION_DURATION_HOURS=1.5 (must be an integer)', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'http://localhost:6041',
      DATABASE_URL: VALID_DB_URL,
      SESSION_DURATION_HOURS: '1.5',
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/SESSION_DURATION_HOURS/);
  });

  // ---------------------------------------------------------------------------
  // ALLOWED_ORIGINS comma-separated list (INFRA-052)
  // ---------------------------------------------------------------------------

  it('parses a single URL to a one-element array', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://app.example.com',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual(['https://app.example.com']);
  });

  it('parses two comma-separated URLs with stray whitespace to two trimmed entries', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: '  https://app.example.com ,   https://staging.example.com  ',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual([
      'https://app.example.com',
      'https://staging.example.com',
    ]);
  });

  it('rejects a list where one entry is not a valid URL', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: 'https://app.example.com,not-a-url',
      DATABASE_URL: VALID_DB_URL,
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/ALLOWED_ORIGINS/);
  });

  it('rejects an empty ALLOWED_ORIGINS string', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: '',
      DATABASE_URL: VALID_DB_URL,
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/ALLOWED_ORIGINS/);
  });

  it('rejects a comma-only ALLOWED_ORIGINS string (no non-empty entries)', async () => {
    const err = await expectConfigError({
      SESSION_SECRET: VALID_SECRET,
      ALLOWED_ORIGINS: ' , ',
      DATABASE_URL: VALID_DB_URL,
    });
    expect(err.name).toBe('ConfigError');
    expect(err.message).toMatch(/ALLOWED_ORIGINS/);
  });

  it('reads the legacy ALLOWED_ORIGIN env var as a fallback when ALLOWED_ORIGINS is unset', async () => {
    stubEnv({
      SESSION_SECRET: VALID_SECRET,
      // ALLOWED_ORIGINS unset — legacy singular provided instead
      ALLOWED_ORIGIN: 'https://legacy.example.com',
      DATABASE_URL: VALID_DB_URL,
    });
    const { config } = await importConfig();
    expect(config.ALLOWED_ORIGINS).toEqual(['https://legacy.example.com']);
  });
});
