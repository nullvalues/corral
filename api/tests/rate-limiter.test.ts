/**
 * Unit tests for the rate-limiter plugin (API-024, INFRA-053).
 *
 * Verifies:
 *   1. Non-auth routes are NOT rate-limited (no 429 even after many requests).
 *   2. Auth endpoints ARE rate-limited using the auth group (RATE_LIMIT_MAX_AUTH).
 *   3. MFA endpoint uses its own group (RATE_LIMIT_MAX_MFA), separate from auth.
 *   4. API endpoints (experiences, mentor-grants/requests) use RATE_LIMIT_MAX_API.
 *   5. Groups are isolated: exhausting the auth bucket does not affect the API bucket.
 *   6. Loopback callers bypass all rate limits.
 *   7. Per-group config vars apply correct defaults when unset.
 *
 * These tests use vi.resetModules() + dynamic import so each describe block
 * can override env vars before config.ts evaluates (config is validated at
 * module-load time). The pattern mirrors api/tests/cors.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = {
  PORT: '6050',
  SESSION_SECRET: 'a'.repeat(64),
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
  DATABASE_URL: 'postgresql://asp:asp@localhost:5432/asp',
  DATABASE_URL_TEST: '',
  ALLOWED_ORIGINS: 'http://localhost:6051',
} as const;

async function importBuildApp(): Promise<
  typeof import('../src/app.js')['buildApp']
> {
  vi.resetModules();
  const mod = await import('../src/app.js');
  return mod.buildApp;
}

describe('rate-limiter plugin — non-auth routes are NOT rate-limited', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('GET /api/health does not return 429 after many requests', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    // Set a very low max so we would hit the limit if health was rate-limited
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_MAX_MFA', '2');
    vi.stubEnv('RATE_LIMIT_MAX_API', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({ method: 'GET', url: '/api/health' });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});

describe('rate-limiter plugin — auth endpoints ARE rate-limited', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('POST /api/auth/sign-in/email returns 429 after max requests exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    // Use a very low max (2) so we can trigger the limit quickly.
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      // First 2 requests should reach the auth handler (not 429).
      // They will return non-429 statuses (400 or 200 depending on BA).
      // Use a non-loopback address so the rate limiter is not bypassed.
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({ email: 'x@x.com', password: 'wrong' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
      // The 3rd request must be 429.
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ email: 'x@x.com', password: 'wrong' }),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });

  it('POST /api/auth/sign-up/email returns 429 after max requests exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-up/email',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({ name: 'X', email: `x${i}@x.com`, password: 'Password1!' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ name: 'X', email: 'x99@x.com', password: 'Password1!' }),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });

  it('POST /api/auth/reset-password returns 429 after max requests exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/reset-password',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({ token: 'sometoken', newPassword: 'Password1!' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ token: 'sometoken', newPassword: 'Password1!' }),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });
});

describe('rate-limiter plugin — MFA endpoint uses its own group (INFRA-053)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('verify-totp uses the MFA limit, not the auth limit — different values prove group isolation', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    // Auth limit = 5 (generous), MFA limit = 2 (tight). If MFA used the auth
    // group, 3 verify-totp calls would NOT trigger 429. The test proves they do.
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '5');
    vi.stubEnv('RATE_LIMIT_MAX_MFA', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      // 2 verify-totp requests pass (MFA limit = 2)
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/two-factor/verify-totp',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({ code: '000000' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
      // 3rd verify-totp must be 429 (MFA limit hit)
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/verify-totp',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ code: '000000' }),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');

      // Auth group should still have headroom (auth limit = 5, none consumed)
      // This proves MFA and auth are isolated buckets.
      const signInRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ email: 'x@x.com', password: 'wrong' }),
      });
      expect(signInRes.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });

  it('POST /api/auth/two-factor/verify-totp returns 429 after MFA limit exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_MFA', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/two-factor/verify-totp',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({ code: '000000' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/verify-totp',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ code: '000000' }),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });
});

describe('rate-limiter plugin — auth group exhaustion does not affect API group (INFRA-053)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('with RATE_LIMIT_MAX_AUTH=2, third sign-in is 429 while /api/experiences requests are unaffected', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_MAX_API', '30'); // generous API limit
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      // Exhaust the auth bucket
      for (let i = 0; i < 2; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({ email: 'x@x.com', password: 'wrong' }),
        });
      }
      // Third sign-in must be 429 (auth bucket exhausted)
      const signInLimited = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ email: 'x@x.com', password: 'wrong' }),
      });
      expect(signInLimited.statusCode).toBe(429);

      // /api/experiences from the same IP must NOT be rate-limited
      // (separate api bucket, not consumed by the auth attempts above)
      const expRes = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({}),
      });
      expect(expRes.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe('rate-limiter plugin — loopback callers bypass rate limit', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('127.0.0.1 caller on auth endpoint is never rate-limited regardless of request count', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      // Send more requests than the limit; loopback should never get 429.
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
          remoteAddress: '127.0.0.1',
          payload: JSON.stringify({ email: 'loop@test.com', password: 'wrong' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
    } finally {
      await app.close();
    }
  });

  it('::1 caller on auth endpoint is never rate-limited', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '::1',
          payload: JSON.stringify({ email: 'loop@test.com', password: 'wrong' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
    } finally {
      await app.close();
    }
  });

  it('::ffff:127.0.0.1 caller on auth endpoint is never rate-limited', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '::ffff:127.0.0.1',
          payload: JSON.stringify({ email: 'loop@test.com', password: 'wrong' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
    } finally {
      await app.close();
    }
  });

  it('external caller with forged x-forwarded-for: 127.0.0.1 is still rate-limited (trustProxy=off)', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();

    // Exhaust the limit from an external address (RATE_LIMIT_MAX_AUTH is set to 2 above)
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '127.0.0.1',  // forged header claiming loopback
        },
        remoteAddress: '203.0.113.99',       // actual external socket peer
        payload: JSON.stringify({ email: 'spoof@example.com', password: 'x' }),
      });
    }

    // The next request should be 429 — the forged header must not bypass the limit
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '127.0.0.1',
      },
      remoteAddress: '203.0.113.99',
      payload: JSON.stringify({ email: 'spoof@example.com', password: 'x' }),
    });

    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it('non-loopback caller on auth endpoint is still rate-limited', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.42',
          payload: JSON.stringify({ email: 'ext@test.com', password: 'wrong' }),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.42',
        payload: JSON.stringify({ email: 'ext@test.com', password: 'wrong' }),
      });
      expect(limitedRes.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('non-loopback caller on non-auth endpoint is never rate-limited', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/health',
          remoteAddress: '203.0.113.42',
        });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});

describe('rate-limiter plugin — applicant mutation routes ARE rate-limited (API-049)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('POST /api/experiences returns 429 after max requests exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_API', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/experiences',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({}),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({}),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/experiences/:id/verification returns 429 after max requests exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_API', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/experiences/abc123/verification',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({}),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'PATCH',
        url: '/api/experiences/abc123/verification',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({}),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });

  it('POST /api/mentor-grants/requests returns 429 after max requests exceeded', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_API', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/mentor-grants/requests',
          headers: { 'content-type': 'application/json' },
          remoteAddress: '203.0.113.1',
          payload: JSON.stringify({}),
        });
        expect(res.statusCode).not.toBe(429);
      }
      const limitedRes = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({}),
      });
      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json<{ error: string }>();
      expect(body.error).toBe('Too Many Requests');
    } finally {
      await app.close();
    }
  });

  it('GET /api/health remains unlimited (unlisted route)', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_API', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/health',
          remoteAddress: '203.0.113.1',
        });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});

describe('rate-limiter plugin — config env vars', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('config accepts RATE_LIMIT_MAX_AUTH, RATE_LIMIT_MAX_MFA, RATE_LIMIT_MAX_API and RATE_LIMIT_WINDOW_MS without throwing', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '5');
    vi.stubEnv('RATE_LIMIT_MAX_MFA', '3');
    vi.stubEnv('RATE_LIMIT_MAX_API', '20');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '30000');
    // Config is validated at import time — if it throws, the import fails.
    const { config } = await import('../src/lib/config.js');
    expect(config.RATE_LIMIT_MAX_AUTH).toBe(5);
    expect(config.RATE_LIMIT_MAX_MFA).toBe(3);
    expect(config.RATE_LIMIT_MAX_API).toBe(20);
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(30000);
  });

  it('defaults apply when per-group vars are unset (auth=10, mfa=10, api=30)', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    const { config } = await import('../src/lib/config.js');
    expect(config.RATE_LIMIT_MAX_AUTH).toBe(10);
    expect(config.RATE_LIMIT_MAX_MFA).toBe(10);
    expect(config.RATE_LIMIT_MAX_API).toBe(30);
    expect(config.RATE_LIMIT_WINDOW_MS).toBeUndefined();
  });

  it('RATE_LIMIT_MAX_AUTH override is respected by the plugin (lower limit triggers 429 sooner)', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    // max=1 → first request passes, second is 429
    vi.stubEnv('RATE_LIMIT_MAX_AUTH', '1');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ email: 'y@y.com', password: 'wrong' }),
      });
      expect(first.statusCode).not.toBe(429);

      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '203.0.113.1',
        payload: JSON.stringify({ email: 'y@y.com', password: 'wrong' }),
      });
      expect(second.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
