/**
 * Integration tests for GET /api/experiences/rollup (API-011).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - Owner with 2 experiences across 2 categories → correct totalHours per category
 *   - Category with no experiences for owner → totalHours: 0
 *   - Third-party (no grant) → 403
 *
 * Cleanup strategy: each test cleans up its own data in a finally block so
 * that FK constraints do not interfere with other test files' afterAll hooks.
 * Experiences are always deleted before their referenced categories.
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { experiences, experienceCategories, mentorGrants } from '../src/db/schema/index.js';
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
    payload: JSON.stringify({ name: 'API-011 User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getUserId(email: string): Promise<string> {
  const result = await db.execute<{ id: string }>(
    `SELECT id FROM users WHERE email = '${email}' LIMIT 1`,
  );
  const rows = result as Array<{ id: string }>;
  if (!rows.length) throw new Error(`User not found: ${email}`);
  return rows[0].id;
}

function makeExperienceBody(categoryId: string, totalHours: number, hoursPerWeek: number, numberOfWeeks: number) {
  return {
    categoryId,
    organization: 'Test Org',
    position: 'Test Position',
    startDate: '2023-01-01',
    dutiesNarrative: 'Did some work.',
    totalHours,
    hoursPerWeek,
    numberOfWeeks,
  };
}

async function seedCategory(slug: string) {
  const [category] = await db
    .insert(experienceCategories)
    .values({ slug, name: `API011 Category ${slug}`, sortOrder: 99, isActive: true })
    .returning();
  return category;
}

async function createExperienceViaApi(
  app: Awaited<ReturnType<typeof buildApp>>,
  sessionCookie: string,
  categoryId: string,
  totalHours: number,
  hoursPerWeek: number,
  numberOfWeeks: number,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/experiences',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    payload: JSON.stringify(makeExperienceBody(categoryId, totalHours, hoursPerWeek, numberOfWeeks)),
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as Record<string, unknown>;
  return body['id'] as string;
}

// ---------------------------------------------------------------------------
// Test: owner rollup with 2 experiences across 2 categories + empty category
// ---------------------------------------------------------------------------

describe('GET /api/experiences/rollup — integration (owner)', () => {
  it('returns correct totalHours per category and 0 for empty categories', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api011-owner-rollup+${Date.now()}@example.com`;
      const cookie = await signUpAndGetSession(app, email);
      const ownerId = await getUserId(email);

      // Seed two categories the owner will have experiences in, and one they won't
      const ts = Date.now();
      const cat1 = await seedCategory(`api011-cat-a-${ts}`);
      const cat2 = await seedCategory(`api011-cat-b-${ts}`);
      const cat3 = await seedCategory(`api011-cat-c-${ts}`);
      catIds.push(cat1.id, cat2.id, cat3.id);

      // Create one experience in cat1: 40 hours
      const exp1 = await createExperienceViaApi(app, cookie, cat1.id, 40, 8, 5);
      expIds.push(exp1);

      // Create one experience in cat2: 60 hours
      const exp2 = await createExperienceViaApi(app, cookie, cat2.id, 60, 12, 5);
      expIds.push(exp2);

      // cat3 has no experiences for this owner

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/rollup?owner_user_id=${ownerId}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{
        categoryId: string;
        categorySlug: string;
        categoryName: string;
        totalHours: number;
      }>;

      // Find our seeded categories in the response
      const row1 = body.find((r) => r.categoryId === cat1.id);
      const row2 = body.find((r) => r.categoryId === cat2.id);
      const row3 = body.find((r) => r.categoryId === cat3.id);

      expect(row1).toBeDefined();
      expect(row1!.totalHours).toBe(40);
      expect(row1!.categorySlug).toBe(cat1.slug);

      expect(row2).toBeDefined();
      expect(row2!.totalHours).toBe(60);
      expect(row2!.categorySlug).toBe(cat2.slug);

      // Category with no experiences → totalHours: 0
      expect(row3).toBeDefined();
      expect(row3!.totalHours).toBe(0);

      // All rows have integer totalHours
      for (const row of body) {
        expect(typeof row.totalHours).toBe('number');
        expect(Number.isInteger(row.totalHours)).toBe(true);
      }
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Test: third-party (no grant) → 403
// ---------------------------------------------------------------------------

describe('GET /api/experiences/rollup — integration (third-party, no grant)', () => {
  it('returns 403 when a third-party caller has no read grant', async () => {
    const app = await buildApp();
    const catIds: string[] = [];
    try {
      const ownerEmail = `api011-owner-tp+${Date.now()}@example.com`;
      const thirdEmail = `api011-third-tp+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const thirdCookie = await signUpAndGetSession(app, thirdEmail);
      const ownerId = await getUserId(ownerEmail);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/rollup?owner_user_id=${ownerId}`,
        headers: { cookie: thirdCookie },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Test: mentor with read grant → 200
// ---------------------------------------------------------------------------

describe('GET /api/experiences/rollup — integration (mentor with read grant)', () => {
  it('returns 200 for mentor with read grant', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const applicantEmail = `api011-app-mg+${Date.now()}@example.com`;
      const mentorEmail = `api011-ment-mg+${Date.now()}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      const cat = await seedCategory(`api011-cat-mg-${Date.now()}`);
      catIds.push(cat.id);

      const grantId = `api011-grant-mg-${Date.now()}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['read'],
      });
      grantIds.push(grantId);

      const exp = await createExperienceViaApi(app, applicantCookie, cat.id, 30, 6, 5);
      expIds.push(exp);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/rollup?owner_user_id=${applicantId}`,
        headers: { cookie: mentorCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ categoryId: string; totalHours: number }>;
      const row = body.find((r) => r.categoryId === cat.id);
      expect(row).toBeDefined();
      expect(row!.totalHours).toBe(30);
    } finally {
      for (const id of grantIds) await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
