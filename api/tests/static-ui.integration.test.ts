/**
 * Integration tests for static UI serving and SPA fallback behaviour (INFRA-013/INFRA-016).
 *
 * These tests verify that when `STATIC_UI_ROOT` is configured, the Fastify app:
 *   1. Serves static files (index.html, asset.js) from the configured directory.
 *   2. Falls back to index.html for unknown non-API paths (SPA client-side routing).
 *   3. Lets explicit API routes win — /api/* space is never intercepted by the wildcard.
 *
 * These run in the "integration" Vitest project (TEST-001). The test does NOT
 * require a real database — it is integration-scoped only because it exercises
 * the full buildApp() registration sequence, and integration tests are the
 * appropriate home for end-to-end plugin behaviour tests.
 *
 * Strategy for injecting a test-controlled STATIC_UI_ROOT:
 *   config.ts parses process.env once at module load time and exports a plain
 *   const object. Because all modules share the same ESM module cache within a
 *   process, mutating the exported `config` object before calling buildApp()
 *   causes staticUiPlugin (which reads config.STATIC_UI_ROOT inside its plugin
 *   function body, not at import time) to see the test value. The original
 *   value is restored in afterAll regardless of test outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { config } from '../src/lib/config.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const fixtureDir = join(tmpdir(), `asp-static-ui-test-${Date.now()}`);
let app: FastifyInstance;
let originalStaticUiRoot: string | undefined;

beforeAll(async () => {
  // Create fixture directory with a minimal SPA index.html and a static asset.
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, 'index.html'), '<html><body>SPA</body></html>');
  writeFileSync(join(fixtureDir, 'asset.js'), '// asset');

  // Temporarily point config at the fixture directory. staticUiPlugin reads
  // config.STATIC_UI_ROOT inside its async plugin body (not at import time),
  // so this mutation is visible when buildApp() calls app.register(staticUiPlugin).
  originalStaticUiRoot = config.STATIC_UI_ROOT;
  (config as Record<string, unknown>)['STATIC_UI_ROOT'] = fixtureDir;

  app = await buildApp();
});

afterAll(async () => {
  await app.close();

  // Restore original config value.
  (config as Record<string, unknown>)['STATIC_UI_ROOT'] = originalStaticUiRoot;

  // Remove the fixture directory.
  rmSync(fixtureDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('static UI serving and SPA fallback (INFRA-016)', () => {
  it('GET / → 200, Content-Type includes text/html', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /asset.js → 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/asset.js' });
    expect(response.statusCode).toBe(200);
  });

  it('GET /api/health → 200, JSON body (API route wins over static serving)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    // Must be JSON, not index.html
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body).toBe('object');
    // Health route returns { status: 'ok' } or similar — at minimum it is parseable JSON
    expect(body).not.toBeNull();
  });

  it('GET /experiences → 200, Content-Type includes text/html (SPA fallback for unknown non-API path)', async () => {
    const response = await app.inject({ method: 'GET', url: '/experiences' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    // Body is the index.html fixture, not an API error response
    expect(response.body).toContain('SPA');
  });

  it('GET /api/nonexistent → 404, JSON body (API route space preserved — not intercepted by SPA fallback)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nonexistent' });
    expect(response.statusCode).toBe(404);
    // Must be JSON, not index.html
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    // Must NOT contain SPA content
    expect(response.body).not.toContain('SPA');
  });
});
