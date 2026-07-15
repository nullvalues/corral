/**
 * Integration tests for insertPiiAccessLog (API-015).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - Mentor with read grant GETs an experience with permissionToContact=true
 *     → pii_access_log row exists with viaGrant=true, correct actor/subject, action='read'
 *   - Mentor with write grant PATCHes an experience
 *     → pii_access_log row exists with action='update'
 *
 * Cleanup strategy: each test cleans up its own data in a finally block so
 * that FK constraints do not interfere with other test files' afterAll hooks.
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  mentorGrants,
  piiAccessLog,
} from '../src/db/schema/index.js';
import { eq, inArray, and } from 'drizzle-orm';

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
    payload: JSON.stringify({ name: 'API-015 User', email, password: 'Password123!' }),
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

async function seedCategory(slug: string) {
  const [category] = await db
    .insert(experienceCategories)
    .values({ slug, name: `API015 Category ${slug}`, sortOrder: 99, isActive: true })
    .returning();
  return category;
}

function makeBody(
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
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

/** Wait briefly for the fire-and-forget insert to settle. */
async function waitForAuditLog(ms = 200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test: mentor reads experience with permissionToContact=true → audit log row
// ---------------------------------------------------------------------------

describe('GET /api/experiences/:id — integration (pii audit log on mentor read)', () => {
  it('inserts a pii_access_log row when mentor reads experience with permissionToContact=true', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    const logIds: string[] = [];
    try {
      const ts = Date.now();
      const applicantEmail = `api015-app-read+${ts}@example.com`;
      const mentorEmail = `api015-ment-read+${ts}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      const category = await seedCategory(`api015-cat-read-${ts}`);
      catIds.push(category.id);

      // Create an experience with permissionToContact=true and some contact PII
      const expId = await createExperienceViaApi(app, applicantCookie, category.id, {
        permissionToContact: true,
        contactFirstName: 'Jane',
        contactLastName: 'Smith',
        contactEmail: 'jane.smith@example.com',
      });
      expIds.push(expId);

      // Grant mentor read access
      const grantId = `api015-grant-read-${ts}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['read'],
      });
      grantIds.push(grantId);

      // Mentor reads the experience
      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/${expId}`,
        headers: { cookie: mentorCookie },
      });
      expect(res.statusCode).toBe(200);

      // Wait for fire-and-forget insert to settle
      await waitForAuditLog();

      // Query the audit log for this resource
      const rows = await db
        .select()
        .from(piiAccessLog)
        .where(
          and(
            eq(piiAccessLog.resourceId, expId),
            eq(piiAccessLog.actorUserId, mentorId),
            eq(piiAccessLog.action, 'read'),
          ),
        );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0];
      expect(row.actorUserId).toBe(mentorId);
      expect(row.subjectUserId).toBe(applicantId);
      expect(row.viaGrant).toBe(true);
      expect(row.action).toBe('read');
      expect(row.resourceType).toBe('experience');

      logIds.push(...rows.map((r) => r.id));
    } finally {
      if (logIds.length) await db.delete(piiAccessLog).where(inArray(piiAccessLog.id, logIds));
      for (const id of grantIds) await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Test: mentor patches an experience → audit log row with action='update'
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — integration (pii audit log on mentor update)', () => {
  it('inserts a pii_access_log row when mentor patches an experience', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    const logIds: string[] = [];
    try {
      const ts = Date.now();
      const applicantEmail = `api015-app-patch+${ts}@example.com`;
      const mentorEmail = `api015-ment-patch+${ts}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      const category = await seedCategory(`api015-cat-patch-${ts}`);
      catIds.push(category.id);

      const expId = await createExperienceViaApi(app, applicantCookie, category.id);
      expIds.push(expId);

      // Grant mentor write access
      const grantId = `api015-grant-patch-${ts}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'active',
        permissions: ['write'],
      });
      grantIds.push(grantId);

      // Mentor patches the experience
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${expId}`,
        headers: { 'content-type': 'application/json', cookie: mentorCookie },
        payload: JSON.stringify({ organization: 'Updated By Mentor' }),
      });
      expect(patchRes.statusCode).toBe(200);

      // Wait for fire-and-forget insert to settle
      await waitForAuditLog();

      // Query the audit log
      const rows = await db
        .select()
        .from(piiAccessLog)
        .where(
          and(
            eq(piiAccessLog.resourceId, expId),
            eq(piiAccessLog.actorUserId, mentorId),
            eq(piiAccessLog.action, 'update'),
          ),
        );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0];
      expect(row.actorUserId).toBe(mentorId);
      expect(row.subjectUserId).toBe(applicantId);
      expect(row.viaGrant).toBe(true);
      expect(row.action).toBe('update');
      expect(row.resourceType).toBe('experience');

      logIds.push(...rows.map((r) => r.id));
    } finally {
      if (logIds.length) await db.delete(piiAccessLog).where(inArray(piiAccessLog.id, logIds));
      for (const id of grantIds) await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Test: no audit log row when experience has permissionToContact=false (mentor read)
// ---------------------------------------------------------------------------

describe('GET /api/experiences/:id — integration (no pii audit log when permissionToContact=false)', () => {
  it('does NOT insert a pii_access_log row when permissionToContact=false', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const ts = Date.now();
      const applicantEmail = `api015-app-nocontact+${ts}@example.com`;
      const mentorEmail = `api015-ment-nocontact+${ts}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const applicantId = await getUserId(applicantEmail);
      const mentorId = await getUserId(mentorEmail);

      const category = await seedCategory(`api015-cat-nocontact-${ts}`);
      catIds.push(category.id);

      // Experience with permissionToContact=false (the default)
      const expId = await createExperienceViaApi(app, applicantCookie, category.id, {
        permissionToContact: false,
      });
      expIds.push(expId);

      const grantId = `api015-grant-nocontact-${ts}`;
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
        method: 'GET',
        url: `/api/experiences/${expId}`,
        headers: { cookie: mentorCookie },
      });
      expect(res.statusCode).toBe(200);

      await waitForAuditLog();

      // No row should exist for this actor+resource+action combination
      const rows = await db
        .select()
        .from(piiAccessLog)
        .where(
          and(
            eq(piiAccessLog.resourceId, expId),
            eq(piiAccessLog.actorUserId, mentorId),
            eq(piiAccessLog.action, 'read'),
          ),
        );

      expect(rows.length).toBe(0);
    } finally {
      for (const id of grantIds) await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
