/**
 * Tests for security headers plugin — INFRA-050.
 *
 * Asserts that responses from a known route include the expected security
 * headers set by @fastify/helmet:
 *
 *   - content-security-policy contains "default-src 'self'"
 *   - x-frame-options is present
 *   - x-content-type-options: nosniff
 *   - strict-transport-security is NOT present when NODE_ENV !== 'production'
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const ENV_STUBS = {
  PORT: '6080',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:6081',
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
} as const;

describe('security headers (helmet plugin)', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV_STUBS)) {
      vi.stubEnv(k, v);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets content-security-policy containing default-src \'self\'', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(typeof csp).toBe('string');
      expect(csp as string).toContain("default-src 'self'");
    } finally {
      await app.close();
    }
  });

  it('sets x-frame-options header', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['x-frame-options']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('sets x-content-type-options: nosniff', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await app.close();
    }
  });

  it('does NOT set strict-transport-security when NODE_ENV !== "production"', async () => {
    // ENV_STUBS sets NODE_ENV=test, so HSTS must be absent.
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['strict-transport-security']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
