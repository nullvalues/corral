import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for the CORS gate (INFRA-010).
 *
 * The gate is a multi-origin allow-list keyed to `config.ALLOWED_ORIGINS`.
 * `@fastify/cors` is registered through `api/src/plugins/cors.ts` with a
 * callback `origin` so the `Access-Control-Allow-Origin` header is ONLY
 * emitted when the request's `Origin` is a member of the canonicalised
 * allow-list. Mismatched origins receive no allow-origin header —
 * the browser then refuses the cross-origin response.
 *
 * `config.ts` validates `process.env` at module-load time, so each test that
 * needs a custom `ALLOWED_ORIGINS` resets the module registry, stubs env, and
 * dynamically imports `buildApp` so the config gate sees the right inputs.
 */

const BASE_ENV = {
  PORT: '6050',
  SESSION_SECRET: 'a'.repeat(64),
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
} as const;

const ALLOWED = 'http://localhost:6051';

async function importBuildApp(): Promise<
  typeof import('../src/app.js')['buildApp']
> {
  vi.resetModules();
  const mod = await import('../src/app.js');
  return mod.buildApp;
}

describe('CORS plugin', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('preflight with matching Origin returns 204 and emits the allow-origin + allow-credentials headers', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: {
          origin: ALLOWED,
          'access-control-request-method': 'GET',
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('preflight with mismatched Origin does NOT emit an allow-origin header', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: {
          origin: 'http://evil.example',
          'access-control-request-method': 'GET',
        },
      });
      // The browser-visible contract: no allow-origin header for a mismatched
      // source. `@fastify/cors` with a callback returning `false` suppresses
      // the header entirely rather than echoing the evil origin.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('actual GET with matching Origin succeeds and includes the allow-origin header', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: ALLOWED },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('actual GET with mismatched Origin does NOT include the allow-origin header', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://evil.example' },
      });
      // The route itself still resolves — same-origin policy is enforced by
      // the BROWSER reading (or not reading) the allow-origin header. What
      // matters for the contract: no allow-origin header is emitted.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('preflight with disallowed method PUT does not include PUT in Access-Control-Allow-Methods', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: {
          origin: ALLOWED,
          'access-control-request-method': 'PUT',
        },
      });
      // The CORS plugin should not advertise PUT as an allowed method.
      // Either the header is absent or it does not contain 'PUT'.
      const allowMethods = res.headers['access-control-allow-methods'];
      if (allowMethods !== undefined) {
        expect(String(allowMethods).split(',').map((m) => m.trim())).not.toContain('PUT');
      }
    } finally {
      await app.close();
    }
  });

  it('OPTIONS preflight for PUT does not include PUT in Allow-Methods', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: {
          origin: ALLOWED,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type',
        },
      });
      const allow = res.headers['access-control-allow-methods'] ?? '';
      expect(allow).not.toContain('PUT');
    } finally {
      await app.close();
    }
  });

  it('trailing-slash ALLOWED_ORIGINS canonicalises so a request from the slash-less form is allowed', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    // Note the trailing slash on the configured origin — INFRA-004's
    // canonicaliseOrigin() strips it before the value reaches the CORS layer.
    vi.stubEnv('ALLOWED_ORIGINS', 'http://localhost:6051/');
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://localhost:6051' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:6051',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('allows each origin in a comma-separated ALLOWED_ORIGINS list', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    const first = 'http://localhost:6051';
    const second = 'https://staging.example.com';
    vi.stubEnv('ALLOWED_ORIGINS', `${first}, ${second}`);
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      for (const origin of [first, second]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/health',
          headers: { origin },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      }
    } finally {
      await app.close();
    }
  });

  it('rejects an origin not in the ALLOWED_ORIGINS list', async () => {
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    vi.stubEnv(
      'ALLOWED_ORIGINS',
      'http://localhost:6051,https://staging.example.com',
    );
    const buildApp = await importBuildApp();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
