/**
 * Unit tests for GET /api/uat/reset-links (UAT-005).
 *
 * Tests two scenarios:
 *   1. UAT=true — route is registered, returns reset-link buffer contents.
 *   2. UAT unset — route is not registered, returns 404.
 *
 * Each test resets modules so config.ts re-evaluates with the stubbed env.
 * The reset-link buffer is cleared between cases to prevent cross-test bleed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = {
  PORT: '6040',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:6041',
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
} as const;

describe('GET /api/uat/reset-links', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(BASE_ENV)) {
      vi.stubEnv(k, v);
    }
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 404 when UAT is unset (empty string)', async () => {
    vi.stubEnv('UAT', '');
    vi.resetModules();

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/uat/reset-links',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns [] when UAT=true and no emails have been sent', async () => {
    vi.stubEnv('UAT', 'true');
    vi.resetModules();

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/uat/reset-links',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns buffered reset links when UAT=true and a reset email was sent', async () => {
    vi.stubEnv('UAT', 'true');
    vi.resetModules();

    // Import the console adapter after module reset so it shares the same
    // buffer instance as the app we build below.
    const { ConsoleMailerAdapter, clearResetLinks } = await import(
      '../src/lib/mailerAdapters/console.js'
    );
    clearResetLinks();

    const adapter = new ConsoleMailerAdapter();
    // Suppress console.log output
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await adapter.sendPasswordReset({
        to: 'applicant@example.com',
        resetUrl: 'https://example.com/reset?token=abc123',
      });
    } finally {
      spy.mockRestore();
    }

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/uat/reset-links',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ email: string; url: string; sentAt: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]!.email).toBe('applicant@example.com');
      expect(body[0]!.url).toBe('https://example.com/reset?token=abc123');
      expect(typeof body[0]!.sentAt).toBe('string');
    } finally {
      await app.close();
    }
  });

  // --- Regression tests for UAT coercion footgun (UAT-012) ---

  it('returns 404 when UAT=false (regression: z.coerce.boolean coerced this to true)', async () => {
    vi.stubEnv('UAT', 'false');
    vi.resetModules();

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/uat/reset-links',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when UAT=0 (defensive operator pattern must not enable the gate)', async () => {
    vi.stubEnv('UAT', '0');
    vi.resetModules();

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/uat/reset-links',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('config throws when UAT=true and NODE_ENV=production (production guard)', async () => {
    vi.stubEnv('UAT', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    // Production also requires MAILER_PROVIDER != console; use resend with required fields
    vi.stubEnv('MAILER_PROVIDER', 'resend');
    vi.stubEnv('MAILER_FROM', 'noreply@example.com');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.resetModules();

    await expect(import('../src/lib/config.js')).rejects.toThrow();
  });

  it('ring buffer caps at 10 entries (oldest entry is dropped)', async () => {
    vi.stubEnv('UAT', 'true');
    vi.resetModules();

    const { ConsoleMailerAdapter, clearResetLinks } = await import(
      '../src/lib/mailerAdapters/console.js'
    );
    clearResetLinks();

    const adapter = new ConsoleMailerAdapter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // Push 11 entries; the first one should be evicted.
      for (let i = 1; i <= 11; i++) {
        await adapter.sendPasswordReset({
          to: `user${i}@example.com`,
          resetUrl: `https://example.com/reset?token=${i}`,
        });
      }
    } finally {
      spy.mockRestore();
    }

    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/uat/reset-links',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ email: string; url: string; sentAt: string }>;
      // Buffer max is 10; oldest (user1) was shifted out.
      expect(body).toHaveLength(10);
      expect(body[0]!.email).toBe('user2@example.com');
      expect(body[9]!.email).toBe('user11@example.com');
    } finally {
      await app.close();
    }
  });
});
