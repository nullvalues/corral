import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

/**
 * Unit tests for GET /api/openapi.json (API-013).
 *
 * Acceptance criteria verified:
 *   1. Returns HTTP 200 with a JSON body.
 *   2. The body contains an `openapi` field (OpenAPI 3.0 version string).
 *   3. The body contains `info.title` and `info.version`.
 *   4. The body contains `servers[0].url`.
 *   5. The route is public — no session cookie required.
 */
const ENV_STUBS = {
  PORT: '6050',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:6051',
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
} as const;

describe('GET /api/openapi.json', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV_STUBS)) {
      vi.stubEnv(k, v);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 200 with OpenAPI 3.0 JSON', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(typeof body['openapi']).toBe('string');
      expect((body['openapi'] as string).startsWith('3.')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('contains info.title and info.version', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
      const body = res.json() as { info: { title: string; version: string } };
      expect(body.info.title).toBe('Corral Talent API');
      expect(body.info.version).toBe('1.0.0');
    } finally {
      await app.close();
    }
  });

  it('contains servers[0].url', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
      const body = res.json() as { servers: Array<{ url: string }> };
      expect(Array.isArray(body.servers)).toBe(true);
      expect(body.servers.length).toBeGreaterThan(0);
      expect(typeof body.servers[0].url).toBe('string');
      expect(body.servers[0].url).toContain('localhost');
    } finally {
      await app.close();
    }
  });

  it('is public — no session cookie required, still 200', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
        headers: {},
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
