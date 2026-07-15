/**
 * Integration tests for POST /api/experiences (API-009).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - Owner (self) can create an experience → 201 with created row
 *   - Mentor with 'write' grant can create on behalf of applicant → 201 with correct ownerUserId
 *   - Mentor without grant trying to set another's ownerUserId → 403
 *   - Hours-triple mismatch → 400 (Zod catches it before DB)
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
    payload: JSON.stringify({ name: 'API-009 User', email, password: 'Password123!' }),
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

/** A factory for a valid create-experience body. Requires a categoryId. */
function makeBody(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    categoryId,
    organization: 'Test Org',
    position: 'Test Position',
    startDate: '2023-01-01',
    dutiesNarrative: 'Did some work.',
    totalHours: 40,
    hoursPerWeek: 8,
    numberOfWeeks: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/experiences — integration (owner self-create)', () => {
  it('returns 201 with the created experience when caller is the owner', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api009-owner+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api009-cat-${Date.now()}`,
          name: 'API009 Category',
          sortOrder: 99,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        payload: JSON.stringify(makeBody(category.id)),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body['id']).toBeDefined();
      expect(body['ownerUserId']).toBe(userId);
      expect(body['organization']).toBe('Test Org');
      expIds.push(body['id'] as string);
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('POST /api/experiences — integration (mentor with write grant)', () => {
  it('returns 201 with correct ownerUserId when mentor has write grant', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const applicantEmail = `api009-applicant+${Date.now()}@example.com`;
      const mentorEmail = `api009-mentor+${Date.now()}@example.com`;

      await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api009-cat2-${Date.now()}`,
          name: 'API009 Cat2',
          sortOrder: 98,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      // Create a mentor grant with 'write' permission
      const grantId = `api009-grant-${Date.now()}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['write'],
      });
      grantIds.push(grantId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: mentorCookie },
        payload: JSON.stringify(makeBody(category.id, { ownerUserId: applicantId })),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body['id']).toBeDefined();
      expect(body['ownerUserId']).toBe(applicantId);
      expIds.push(body['id'] as string);
    } finally {
      for (const id of grantIds) {
        await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      }
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('POST /api/experiences — integration (mentor without write grant)', () => {
  it('returns 403 when mentor tries to create on behalf without a write grant', async () => {
    const app = await buildApp();
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const applicantEmail = `api009-applicant2+${Date.now()}@example.com`;
      const mentorEmail = `api009-mentor2+${Date.now()}@example.com`;

      await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api009-cat3-${Date.now()}`,
          name: 'API009 Cat3',
          sortOrder: 97,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      // Create a mentor grant with only 'read' permission (not 'write')
      const grantId = `api009-grant2-${Date.now()}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['read'],
      });
      grantIds.push(grantId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: mentorCookie },
        payload: JSON.stringify(makeBody(category.id, { ownerUserId: applicantId })),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      for (const id of grantIds) {
        await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      }
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('POST /api/experiences — integration (hours-triple validation)', () => {
  it('returns 400 when totalHours does not equal hoursPerWeek × numberOfWeeks', async () => {
    const app = await buildApp();
    const catIds: string[] = [];
    try {
      const email = `api009-owner3+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api009-cat4-${Date.now()}`,
          name: 'API009 Cat4',
          sortOrder: 96,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        payload: JSON.stringify(
          makeBody(category.id, {
            totalHours: 99, // 8 * 5 = 40, not 99 — hours-triple mismatch
          }),
        ),
      });

      expect(res.statusCode).toBe(400);
    } finally {
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
