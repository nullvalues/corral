/**
 * Integration tests for API-041: Categories CRUD accepts and returns goalHours.
 *
 * Covers (API-041 Ensures):
 * - POST as admin with goalHours: 750 → 201, body goalHours === 750.
 * - POST as admin omitting goalHours → 201, body goalHours === null.
 * - PATCH as admin setting goalHours: 0 → 200, body goalHours === 0.
 * - PATCH as admin with goalHours: null → 200, body goalHours === null.
 * - POST with goalHours: -5 → 400 (Zod nonnegative).
 * - GET (any authed) returns goalHours on each category.
 * - Non-admin POST/PATCH still → 403 (auth gate intact).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles, experienceCategories } from '../src/db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-041 User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getUserId(email: string): Promise<string> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!rows.length) throw new Error(`User not found: ${email}`);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Experience categories — goalHours CRUD (API-041)', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let applicantCookie: string;

  const ts = Date.now();
  const adminEmail = `api041-admin+${ts}@example.com`;
  const applicantEmail = `api041-applicant+${ts}@example.com`;

  // Track created category IDs for cleanup
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();

    adminCookie = await signUpAndGetSession(app, adminEmail);
    applicantCookie = await signUpAndGetSession(app, applicantEmail);

    const adminId = await getUserId(adminEmail);
    await db.insert(systemRoles).values({ userId: adminId, role: 'admin' }).onConflictDoNothing();
  });

  afterAll(async () => {
    // Clean up created categories
    if (createdCategoryIds.length > 0) {
      await db
        .delete(experienceCategories)
        .where(inArray(experienceCategories.id, createdCategoryIds));
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST tests
  // ---------------------------------------------------------------------------

  it('admin: POST with goalHours: 750 → 201, body goalHours === 750', async () => {
    const slug = `api041-goal750-${ts}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'API-041 Goal 750', goalHours: 750 }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; goalHours: number | null };
    expect(body.goalHours).toBe(750);
    createdCategoryIds.push(body.id);
  });

  it('admin: POST omitting goalHours → 201, body goalHours === null', async () => {
    const slug = `api041-nohours-${ts}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'API-041 No Hours' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; goalHours: number | null };
    expect(body.goalHours).toBeNull();
    createdCategoryIds.push(body.id);
  });

  it('admin: POST with goalHours: null → 201, body goalHours === null', async () => {
    const slug = `api041-nullhours-${ts}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'API-041 Null Hours', goalHours: null }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; goalHours: number | null };
    expect(body.goalHours).toBeNull();
    createdCategoryIds.push(body.id);
  });

  it('admin: POST with goalHours: -5 → 400 (Zod nonnegative)', async () => {
    const slug = `api041-neghours-${ts}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'API-041 Neg Hours', goalHours: -5 }),
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // PATCH tests
  // ---------------------------------------------------------------------------

  it('admin: PATCH setting goalHours: 0 → 200, body goalHours === 0', async () => {
    // Create a category to patch
    const slug = `api041-patch0-${ts}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'API-041 Patch Zero', goalHours: 500 }),
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string };
    createdCategoryIds.push(created.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experience-categories/${created.id}`,
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ goalHours: 0 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { goalHours: number | null };
    expect(body.goalHours).toBe(0);
  });

  it('admin: PATCH with goalHours: null → 200, body goalHours === null', async () => {
    const slug = `api041-patchnull-${ts}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'API-041 Patch Null', goalHours: 300 }),
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string };
    createdCategoryIds.push(created.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experience-categories/${created.id}`,
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ goalHours: null }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { goalHours: number | null };
    expect(body.goalHours).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // GET tests
  // ---------------------------------------------------------------------------

  it('any authed: GET /api/experience-categories returns goalHours on each item', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/experience-categories',
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; goalHours: number | null }>;
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      // goalHours must be present (either a number or null, never undefined)
      expect(item).toHaveProperty('goalHours');
      if (item.goalHours !== null) {
        expect(typeof item.goalHours).toBe('number');
        expect(item.goalHours).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Auth gate tests
  // ---------------------------------------------------------------------------

  it('non-admin (applicant): POST /api/experience-categories → 403', async () => {
    const slug = `api041-nonadmin-post-${ts}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { cookie: applicantCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ slug, name: 'Should Fail', goalHours: 100 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('non-admin (applicant): PATCH /api/experience-categories/:id → 403', async () => {
    // Use a proper v4 UUID (Zod v4 requires version=4 and correct variant bits)
    const fakeId = '00000000-0000-4000-8000-000000000001';
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experience-categories/${fakeId}`,
      headers: { cookie: applicantCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ goalHours: 100 }),
    });
    expect(res.statusCode).toBe(403);
  });
});
