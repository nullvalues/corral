/**
 * Integration tests for POST/PATCH/DELETE /api/experience-categories (API-006).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test. No graceful skip — if DATABASE_URL_TEST is absent,
 * globalSetup throws a clear error.
 *
 * Tests verify:
 *   - Admin user: POST creates a category (201).
 *   - Admin user: PATCH updates the category (200).
 *   - Admin user: DELETE removes the category (204).
 *   - Non-existent ID → 404 on PATCH and DELETE.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { experienceCategories, experiences, systemRoles } from '../src/db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUpAndGetSession(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-006 User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getUserId(email: string): Promise<string> {
  // BA stores users in the 'users' table. We select by email.
  // We use a raw query via drizzle since the users table is in the auth schema.
  const result = await db.execute<{ id: string }>(
    `SELECT id FROM users WHERE email = '${email}' LIMIT 1`,
  );
  const rows = result as Array<{ id: string }>;
  if (!rows.length) throw new Error(`User not found: ${email}`);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  // Clean up experiences inserted by FK-guard tests (must be deleted before categories due to FK).
  await db.delete(experiences).where(
    inArray(experiences.categoryId,
      (await db.select({ id: experienceCategories.id })
        .from(experienceCategories)
        .where(inArray(experienceCategories.slug, ['api006-in-use']))).map((r) => r.id)
    )
  );

  // Clean up only the specific categories inserted by this test suite.
  // Using targeted slug deletes rather than a blanket wipe to avoid interfering
  // with concurrent test files that also reference experience_categories.
  await db
    .delete(experienceCategories)
    .where(
      inArray(experienceCategories.slug, [
        'api006-new',
        'api006-patch-me',
        'api006-delete-me',
        'api006-empty',
        'api006-in-use',
      ]),
    );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/experience-categories — integration (admin)', () => {
  it('creates a category and returns 201 with the row', async () => {
    const app = await buildApp();
    try {
      const email = `api006-post+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      // Grant admin role
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const res = await app.inject({
        method: 'POST',
        url: '/api/experience-categories',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        payload: JSON.stringify({ slug: 'api006-new', name: 'API006 New Category', sortOrder: 99 }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body['slug']).toBe('api006-new');
      expect(body['name']).toBe('API006 New Category');
      expect(body['sortOrder']).toBe(99);
      expect(typeof body['id']).toBe('string');

      // Cleanup role
      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const app = await buildApp();
    try {
      const email = `api006-nonadmin+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);

      const res = await app.inject({
        method: 'POST',
        url: '/api/experience-categories',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        payload: JSON.stringify({ slug: 'api006-denied', name: 'Should Be Denied' }),
      });

      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/experience-categories/:id — integration (admin)', () => {
  it('updates a category and returns 200 with the updated row', async () => {
    const app = await buildApp();
    try {
      const email = `api006-patch+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      // Insert a category to update
      const [inserted] = await db
        .insert(experienceCategories)
        .values({ slug: 'api006-patch-me', name: 'Original Name', sortOrder: 10, isActive: true })
        .returning();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experience-categories/${inserted.id}`,
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        payload: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['name']).toBe('Updated Name');
      expect(body['slug']).toBe('api006-patch-me');

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });

  it('returns 404 for a non-existent id', async () => {
    const app = await buildApp();
    try {
      const email = `api006-patch404+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/experience-categories/00000000-0000-4000-8000-000000000099',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        payload: JSON.stringify({ name: 'Ghost' }),
      });

      expect(res.statusCode).toBe(404);

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/experience-categories/:id — integration (admin)', () => {
  it('deletes a category and returns 204', async () => {
    const app = await buildApp();
    try {
      const email = `api006-delete+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const [inserted] = await db
        .insert(experienceCategories)
        .values({ slug: 'api006-delete-me', name: 'Delete Me', sortOrder: 20, isActive: true })
        .returning();

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${inserted.id}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(204);

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });

  it('returns 404 for a non-existent id', async () => {
    const app = await buildApp();
    try {
      const email = `api006-del404+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/experience-categories/00000000-0000-4000-8000-000000000098',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(404);

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/experience-categories/:id — FK guard (API-039)', () => {
  it('returns 204 when deleting a category with zero experiences', async () => {
    const app = await buildApp();
    try {
      const email = `api039-empty+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const [inserted] = await db
        .insert(experienceCategories)
        .values({ slug: 'api006-empty', name: 'Empty Category', sortOrder: 50, isActive: true })
        .returning();

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${inserted.id}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(204);

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });

  it('returns 409 when deleting a category that has experiences assigned; category row still exists', async () => {
    const app = await buildApp();
    try {
      const email = `api039-inuse+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const [cat] = await db
        .insert(experienceCategories)
        .values({ slug: 'api006-in-use', name: 'In Use Category', sortOrder: 51, isActive: true })
        .returning();

      // Insert an experience referencing this category
      await db.insert(experiences).values({
        ownerUserId: userId,
        categoryId: cat.id,
        organization: 'Test Org',
        position: 'Test Position',
        startDate: new Date('2023-01-01'),
        dutiesNarrative: 'Test duties',
        totalHours: 40,
        hoursPerWeek: 10,
        numberOfWeeks: 4,
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${cat.id}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(409);
      expect(res.statusCode).not.toBe(500);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Cannot delete a category that has experiences assigned to it.');

      // Category row must still exist
      const rows = await db
        .select()
        .from(experienceCategories)
        .where(eq(experienceCategories.id, cat.id));
      expect(rows.length).toBe(1);

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });

  it('returns 404 for a non-existent UUID', async () => {
    const app = await buildApp();
    try {
      const email = `api039-notfound+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);
      await db.insert(systemRoles).values({ userId, role: 'admin' }).onConflictDoNothing();

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/experience-categories/00000000-0000-4000-8000-000000000097',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(404);

      await db.delete(systemRoles).where(eq(systemRoles.userId, userId));
    } finally {
      await app.close();
    }
  });
});
