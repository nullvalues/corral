import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

/**
 * Integration tests for the public health probe.
 *
 * Two acceptance criteria from INFRA-006 are verified here:
 *   1. `GET /api/health` returns 200 with the canonical body `{ status: 'ok' }`.
 *   2. The route is unauthenticated — a caller with no session cookie still
 *      gets 200. Auth is not wired in Phase 1, so this is structural insurance:
 *      when auth lands (Phase 2), the test will catch any accidental global
 *      pre-handler that would otherwise have started gating `/api/health`.
 *
 * The env stubs mirror `app.test.ts` so the config gate (INFRA-004) is
 * satisfied during `buildApp()`.
 */
const ENV_STUBS = {
  PORT: '6050',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:6051',
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
} as const;

describe('GET /api/health', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV_STUBS)) {
      vi.stubEnv(k, v);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 200 with body { status: "ok" }', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('does NOT require auth — no session cookie, still 200', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        // Deliberately omit any cookie/Authorization header.
        headers: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
