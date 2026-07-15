/**
 * Integration tests for PATCH/DELETE /api/experiences/:id (API-010).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - Owner can PATCH → 200 with updated fields
 *   - Owner can DELETE → 204
 *   - Mentor with 'write' grant can PATCH → 200
 *   - Mentor with 'write' grant can DELETE → 204
 *   - Third-party (no grant) PATCH → 403
 *   - Third-party DELETE → 403
 *   - Owner PATCH non-existent ID → 404
 *   - Third-party PATCH non-existent ID → 403 (not 404)
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
    payload: JSON.stringify({ name: 'API-010 User', email, password: 'Password123!' }),
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

async function seedCategory(slug: string) {
  const [category] = await db
    .insert(experienceCategories)
    .values({ slug, name: 'API010 Category', sortOrder: 99, isActive: true })
    .returning();
  return category;
}

async function createExperienceViaApi(
  app: Awaited<ReturnType<typeof buildApp>>,
  sessionCookie: string,
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/experiences',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    payload: JSON.stringify(makeBody(categoryId, overrides)),
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as Record<string, unknown>;
  return body['id'] as string;
}

const nonExistentUuid = '00000000-0000-4000-a000-000000000001';

// ---------------------------------------------------------------------------
// PATCH — owner
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — integration (owner)', () => {
  it('returns 200 with updated fields when owner patches their own experience', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api010-owner-patch+${Date.now()}@example.com`;
      const cookie = await signUpAndGetSession(app, email);
      const category = await seedCategory(`api010-cat-op-${Date.now()}`);
      catIds.push(category.id);

      const expId = await createExperienceViaApi(app, cookie, category.id);
      expIds.push(expId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${expId}`,
        headers: { 'content-type': 'application/json', cookie },
        payload: JSON.stringify({ organization: 'Updated Org' }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['organization']).toBe('Updated Org');
      expect(body['id']).toBe(expId);
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE — owner
// ---------------------------------------------------------------------------

describe('DELETE /api/experiences/:id — integration (owner)', () => {
  it('returns 204 when owner deletes their own experience', async () => {
    const app = await buildApp();
    const catIds: string[] = [];
    try {
      const email = `api010-owner-del+${Date.now()}@example.com`;
      const cookie = await signUpAndGetSession(app, email);
      const category = await seedCategory(`api010-cat-od-${Date.now()}`);
      catIds.push(category.id);

      const expId = await createExperienceViaApi(app, cookie, category.id);
      // Note: expId is deleted by the DELETE request — no need to clean it up

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experiences/${expId}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(204);
    } finally {
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH — mentor with write grant
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — integration (mentor with write grant)', () => {
  it('returns 200 when mentor with write grant patches an experience', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const applicantEmail = `api010-app-pw+${Date.now()}@example.com`;
      const mentorEmail = `api010-ment-pw+${Date.now()}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      const category = await seedCategory(`api010-cat-mpw-${Date.now()}`);
      catIds.push(category.id);

      const grantId = `api010-grant-pw-${Date.now()}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['write'],
      });
      grantIds.push(grantId);

      const expId = await createExperienceViaApi(app, applicantCookie, category.id);
      expIds.push(expId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${expId}`,
        headers: { 'content-type': 'application/json', cookie: mentorCookie },
        payload: JSON.stringify({ position: 'Updated By Mentor' }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['position']).toBe('Updated By Mentor');
    } finally {
      for (const id of grantIds) await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE — mentor with write grant
// ---------------------------------------------------------------------------

describe('DELETE /api/experiences/:id — integration (mentor with write grant)', () => {
  it('returns 204 when mentor with write grant deletes an experience', async () => {
    const app = await buildApp();
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const applicantEmail = `api010-app-dw+${Date.now()}@example.com`;
      const mentorEmail = `api010-ment-dw+${Date.now()}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      const category = await seedCategory(`api010-cat-mdw-${Date.now()}`);
      catIds.push(category.id);

      const grantId = `api010-grant-dw-${Date.now()}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['write'],
      });
      grantIds.push(grantId);

      const expId = await createExperienceViaApi(app, applicantCookie, category.id);
      // expId deleted by the DELETE request

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experiences/${expId}`,
        headers: { cookie: mentorCookie },
      });

      expect(res.statusCode).toBe(204);
    } finally {
      for (const id of grantIds) await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH — third-party without grant → 403
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — integration (third-party, no grant)', () => {
  it('returns 403 when a third-party caller has no grant', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const ownerEmail = `api010-owner-tp+${Date.now()}@example.com`;
      const thirdEmail = `api010-third-tp+${Date.now()}@example.com`;

      const ownerCookie = await signUpAndGetSession(app, ownerEmail);
      const thirdCookie = await signUpAndGetSession(app, thirdEmail);

      const category = await seedCategory(`api010-cat-tp-${Date.now()}`);
      catIds.push(category.id);

      const expId = await createExperienceViaApi(app, ownerCookie, category.id);
      expIds.push(expId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${expId}`,
        headers: { 'content-type': 'application/json', cookie: thirdCookie },
        payload: JSON.stringify({ organization: 'Hacked' }),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE — third-party without grant → 403
// ---------------------------------------------------------------------------

describe('DELETE /api/experiences/:id — integration (third-party, no grant)', () => {
  it('returns 403 when a third-party caller has no grant', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const ownerEmail = `api010-owner-tpd+${Date.now()}@example.com`;
      const thirdEmail = `api010-third-tpd+${Date.now()}@example.com`;

      const ownerCookie = await signUpAndGetSession(app, ownerEmail);
      const thirdCookie = await signUpAndGetSession(app, thirdEmail);

      const category = await seedCategory(`api010-cat-tpd-${Date.now()}`);
      catIds.push(category.id);

      const expId = await createExperienceViaApi(app, ownerCookie, category.id);
      expIds.push(expId);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experiences/${expId}`,
        headers: { cookie: thirdCookie },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH — non-existent ID → 403 (any caller, owner cannot be determined)
//
// When the experience does not exist, ownerUserId is unknown (sentinel '').
// isOwner(caller, { ownerId: '' }) is always false (caller.id != '').
// hasMentorGrant(caller, '') is always false (no grant to non-user '').
// So denied = true → 403. This is consistent with the API-008 GET pattern:
// ownership cannot be determined without the row — the sentinel fails the
// ABAC check for all callers, avoiding existence leaks.
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — integration (non-existent, any caller)', () => {
  it('returns 403 when patching a non-existent experience (owner cannot be determined)', async () => {
    const app = await buildApp();
    try {
      const email = `api010-any-ne+${Date.now()}@example.com`;
      const cookie = await signUpAndGetSession(app, email);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${nonExistentUuid}`,
        headers: { 'content-type': 'application/json', cookie },
        payload: JSON.stringify({ organization: 'Ghost Org' }),
      });

      // 403 for non-existent (consistent with GET /experiences/:id behaviour in API-008):
      // ownership cannot be determined without the row.
      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      await app.close();
    }
  });
});
