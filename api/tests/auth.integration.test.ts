/**
 * Auth integration tests.
 *
 * These tests exercise the Better Auth HTTP handlers against a real database.
 * They run in the "integration" Vitest project (TEST-001), which requires
 * DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup before
 * the first test. No graceful skip — if DATABASE_URL_TEST is absent,
 * globalSetup throws a clear error.
 *
 * Note: the three unit-level describe blocks at the bottom (schema migration,
 * cookie config, dependency audit) do not require a DB but live in this file
 * because they test auth-related exports. They run cleanly in the integration
 * project.
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildAuthConfig } from '../src/services/auth/index.js';
import { generate as totpGenerate } from 'otplib';

describe('auth integration', () => {
  it('POST /api/auth/sign-up/email returns 200 for new user', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Test User',
        email: `test+${Date.now()}@example.com`,
        password: 'Password123!',
      }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('POST /api/auth/sign-in/email returns 200 for existing user', async () => {
    const app = await buildApp();
    const email = `test+${Date.now()}@example.com`;
    // Sign up first
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Test User',
        email,
        password: 'Password123!',
      }),
    });
    // Then sign in
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email, password: 'Password123!' }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('POST /api/auth/sign-in/email Set-Cookie contains HttpOnly and SameSite=Lax (NODE_ENV=test, no Secure)', async () => {
    const app = await buildApp();
    const email = `test+${Date.now()}@example.com`;
    // Sign up first
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Cookie Test User',
        email,
        password: 'Password123!',
      }),
    });
    // Sign in
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email, password: 'Password123!' }),
    });
    expect(response.statusCode).toBe(200);

    const setCookieHeaders = response.headers['set-cookie'];
    const rawCookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : typeof setCookieHeaders === 'string'
        ? [setCookieHeaders]
        : [];

    // At least one Set-Cookie header should be present (the session token cookie)
    expect(rawCookies.length).toBeGreaterThan(0);

    // Join all cookies for a simple includes check
    const cookiesStr = rawCookies.join('; ');
    expect(cookiesStr).toMatch(/HttpOnly/i);
    expect(cookiesStr).toMatch(/SameSite=Lax/i);
    // In test env (not production), Secure must NOT be present
    expect(cookiesStr).not.toMatch(/;\s*Secure/i);

    await app.close();
  });

  it('after sign-in, sessions table contains ≥1 row for the user (DB-backed sessions)', async () => {
    const app = await buildApp();
    const email = `test+${Date.now()}@example.com`;
    // Sign up
    const signUpResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'DB Session User',
        email,
        password: 'Password123!',
      }),
    });
    expect(signUpResponse.statusCode).toBe(200);
    const signUpBody = JSON.parse(signUpResponse.body) as { user?: { id?: string } };
    const userId = signUpBody.user?.id;
    expect(userId).toBeTruthy();

    // The sign-up itself creates a session; verify in DB
    const { db: testDb } = await import('../src/db/index.js');
    const { sql } = await import('drizzle-orm');
    const rows = await testDb.execute(
      sql`SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ${userId}`,
    );
    const count = Number((rows as Array<Record<string, unknown>>)[0]?.['cnt'] ?? 0);
    expect(count).toBeGreaterThanOrEqual(1);

    await app.close();
  });
});

// ─── Two-factor (TOTP) integration tests (AUTH-003) ─────────────────────────

describe('two-factor TOTP integration', () => {
  /**
   * Helper: sign up a fresh user and return the session cookie string.
   */
  const TF_PASSWORD = 'Password123!';

  async function signUpAndGetSession(
    app: Awaited<ReturnType<typeof buildApp>>,
  ): Promise<{ sessionCookie: string; email: string; userId: string }> {
    const email = `tf+${Date.now()}@example.com`;
    const signUpResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'TF User', email, password: TF_PASSWORD }),
    });
    expect(signUpResponse.statusCode).toBe(200);
    const body = JSON.parse(signUpResponse.body) as { user?: { id?: string } };
    const userId = body.user?.id ?? '';
    expect(userId).toBeTruthy();

    // Extract Set-Cookie header(s)
    const raw = signUpResponse.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    // Join cookie names+values (strip attributes) so we can send them back
    const sessionCookie = cookies
      .map((c) => c.split(';')[0])
      .join('; ');
    return { sessionCookie, email, userId };
  }

  it('POST /api/auth/two-factor/enable returns 200 with totpURI and backupCodes', async () => {
    const app = await buildApp();
    const { sessionCookie } = await signUpAndGetSession(app);

    // BA's shouldRequirePassword returns true for email+password users even with
    // allowPasswordless:true — the option only skips the password for passwordless
    // sign-up flows. Email+password users must re-supply their password here.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/enable',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
      },
      payload: JSON.stringify({ password: TF_PASSWORD }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { totpURI?: string; backupCodes?: string[] };
    expect(body.totpURI).toBeTruthy();
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(Array.isArray(body.backupCodes)).toBe(true);
    expect((body.backupCodes ?? []).length).toBeGreaterThan(0);

    await app.close();
  });

  it('POST /api/auth/two-factor/verify-totp with valid code returns 200 and marks user twoFactorEnabled', async () => {
    const app = await buildApp();
    const { sessionCookie, userId } = await signUpAndGetSession(app);

    // Enable 2FA — get the totpURI (password required for email+password users)
    const enableRes = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/enable',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      payload: JSON.stringify({ password: TF_PASSWORD }),
    });
    expect(enableRes.statusCode).toBe(200);
    const { totpURI } = JSON.parse(enableRes.body) as { totpURI: string };

    // Parse the base32 secret out of the otpauth URI
    const otpauthUrl = new URL(totpURI);
    const secret = otpauthUrl.searchParams.get('secret') ?? '';
    expect(secret).toBeTruthy();

    // Generate a valid TOTP code using otplib
    const code = await totpGenerate({ secret });

    // Verify the TOTP code
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      payload: JSON.stringify({ code }),
    });

    expect(verifyRes.statusCode).toBe(200);

    // Confirm twoFactorEnabled in the DB
    const { db: testDb } = await import('../src/db/index.js');
    const { sql } = await import('drizzle-orm');
    const rows = await testDb.execute(
      sql`SELECT "two_factor_enabled" FROM users WHERE id = ${userId}`,
    );
    const enabled = (rows as Array<Record<string, unknown>>)[0]?.['two_factor_enabled'];
    expect(enabled).toBe(true);

    await app.close();
  });

  it('POST /api/auth/two-factor/verify-totp with wrong code returns non-200', async () => {
    const app = await buildApp();
    const { sessionCookie } = await signUpAndGetSession(app);

    // Enable 2FA first (password required for email+password users)
    const enableRes = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/enable',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      payload: JSON.stringify({ password: TF_PASSWORD }),
    });
    expect(enableRes.statusCode).toBe(200);

    // Verify with a deliberately wrong code
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      payload: JSON.stringify({ code: '000000' }),
    });

    expect(verifyRes.statusCode).not.toBe(200);

    await app.close();
  });

  it('POST /api/auth/two-factor/verify-totp before enable returns non-200', async () => {
    const app = await buildApp();
    const { sessionCookie } = await signUpAndGetSession(app);

    // Attempt verify-totp without having called enable first
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      payload: JSON.stringify({ code: '123456' }),
    });

    expect(verifyRes.statusCode).not.toBe(200);

    await app.close();
  });
});

// ─── Schema test — migration introduces expected columns/tables ──────────────

describe('two-factor schema migration — unit', () => {
  it('migration SQL introduces two_factor table with expected columns', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = dirname(fileURLToPath(import.meta.url));
    const migrationSql = readFileSync(
      resolve(dir, '../drizzle/0001_quick_black_queen.sql'),
      'utf8',
    );
    expect(migrationSql).toContain('CREATE TABLE "two_factor"');
    expect(migrationSql).toContain('"secret" text NOT NULL');
    expect(migrationSql).toContain('"backup_codes" text NOT NULL');
    expect(migrationSql).toContain('"user_id" text NOT NULL');
    expect(migrationSql).toContain('"two_factor_enabled" boolean');
  });
});

// ─── Unit-level tests (no DB required) ──────────────────────────────────────

describe('auth cookie config — unit', () => {
  it('buildAuthConfig(false): secure=false, httpOnly=true, sameSite=lax', () => {
    const cfg = buildAuthConfig(false);
    const attrs = cfg.advanced.cookies.sessionToken.attributes;
    expect(attrs.httpOnly).toBe(true);
    expect(attrs.secure).toBe(false);
    expect(attrs.sameSite).toBe('lax');
  });

  it('buildAuthConfig(true): secure=true, httpOnly=true, sameSite=lax', () => {
    const cfg = buildAuthConfig(true);
    const attrs = cfg.advanced.cookies.sessionToken.attributes;
    expect(attrs.httpOnly).toBe(true);
    expect(attrs.secure).toBe(true);
    expect(attrs.sameSite).toBe('lax');
  });
});

describe('dependency audit — no Redis', () => {
  it('neither ioredis nor redis packages are resolvable from @asp/api', async () => {
    const tryResolve = (pkg: string): boolean => {
      try {
        require.resolve(pkg, { paths: [new URL('../', import.meta.url).pathname] });
        return true;
      } catch {
        return false;
      }
    };
    expect(tryResolve('ioredis')).toBe(false);
    expect(tryResolve('redis')).toBe(false);
  });
});
