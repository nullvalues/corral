/**
 * Integration tests for GET /api/experience-categories (API-005).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test. No graceful skip — if DATABASE_URL_TEST is absent,
 * globalSetup throws a clear error.
 *
 * Tests verify that:
 *   - A signed-in user receives 200 with an array of categories.
 *   - Each item in the array has the expected fields.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { experienceCategories } from '../src/db/schema/index.js';
import { inArray } from 'drizzle-orm';

/**
 * Helper: sign up a new user and return the session cookie string.
 */
async function signUpAndGetSession(
  app: Awaited<ReturnType<typeof buildApp>>,
): Promise<string> {
  const email = `api005+${Date.now()}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-005 User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('GET /api/experience-categories — integration', () => {
  afterAll(async () => {
    // Clean up only the specific categories inserted by this test suite.
    // Using targeted slug deletes rather than a blanket wipe to avoid interfering
    // with concurrent test files that also reference experience_categories.
    await db
      .delete(experienceCategories)
      .where(
        inArray(experienceCategories.slug, ['test-category', 'field-check-cat']),
      );
  });

  it('returns 200 with a JSON array for a signed-in user', async () => {
    const app = await buildApp();
    try {
      // Seed a category so the response array is non-empty.
      await db.insert(experienceCategories).values({
        slug: 'test-category',
        name: 'Test Category',
        sortOrder: 1,
        isActive: true,
      }).onConflictDoNothing();

      const sessionCookie = await signUpAndGetSession(app);

      const res = await app.inject({
        method: 'GET',
        url: '/api/experience-categories',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('each item has id, slug, name, sortOrder, isActive, createdAt', async () => {
    const app = await buildApp();
    try {
      // Ensure at least one category exists.
      await db.insert(experienceCategories).values({
        slug: 'field-check-cat',
        name: 'Field Check Category',
        sortOrder: 2,
        isActive: true,
      }).onConflictDoNothing();

      const sessionCookie = await signUpAndGetSession(app);

      const res = await app.inject({
        method: 'GET',
        url: '/api/experience-categories',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<Record<string, unknown>>;
      expect(body.length).toBeGreaterThan(0);

      const item = body[0];
      expect(typeof item['id']).toBe('string');
      expect(typeof item['slug']).toBe('string');
      expect(typeof item['name']).toBe('string');
      expect(typeof item['sortOrder']).toBe('number');
      expect(typeof item['isActive']).toBe('boolean');
      // createdAt is serialized as an ISO string over JSON
      expect(typeof item['createdAt']).toBe('string');
    } finally {
      await app.close();
    }
  });
});
