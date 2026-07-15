/**
 * Integration tests for GET /api/experiences/export (API-062).
 *
 * Runs in the "integration" Vitest project (TEST-001), which requires
 * DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup.
 *
 * Tests verify:
 *   - Applicant exporting own data → 200, text/csv, attachment header,
 *     exact column header row, one data row per experience.
 *   - A field containing a comma/quote is correctly CSV-escaped.
 *   - Applicant requesting another user's owner_user_id → 403.
 *   - Admin exporting an arbitrary owner_user_id → 200.
 *   - The /export path is not shadowed by /experiences/:id.
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { experiences, experienceCategories, systemRoles } from '../src/db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';

async function signUpAndGetSession(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-062 User', email, password: 'Password123!' }),
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

const EXPECTED_HEADER =
  'organization,position,category,frequency,startDate,endDate,totalHours,' +
  'hoursPerWeek,numberOfWeeks,isVolunteer,receivedSalaryOrPayment,' +
  'receivedAcademicCredit,isMostImportant,verificationStatus,stateProvince,country';

describe('GET /api/experiences/export — integration (owner)', () => {
  it('returns 200 CSV with exact header and one row per experience', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api062-owner+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api062-cat-${Date.now()}`,
          name: 'API062 Category',
          sortOrder: 99,
          isActive: false,
        })
        .returning();
      catIds.push(category.id);

      for (let i = 0; i < 2; i++) {
        const [exp] = await db
          .insert(experiences)
          .values({
            ownerUserId: userId,
            categoryId: category.id,
            organization: `Org ${i}`,
            position: `Position ${i}`,
            startDate: new Date('2023-01-01'),
            endDate: null,
            dutiesNarrative: 'Did some work.',
            totalHours: 40,
            hoursPerWeek: 8,
            numberOfWeeks: 5,
          })
          .returning();
        expIds.push(exp.id);
      }

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/export?owner_user_id=${userId}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="experiences-export.csv"',
      );

      const lines = res.body.split('\r\n');
      expect(lines[0]).toBe(EXPECTED_HEADER);
      // One header + two data rows.
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain('Org');
      expect(lines[2]).toContain('Org');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });

  it('omitting owner_user_id defaults to the caller and returns their own rows', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api062-self+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api062-cat-self-${Date.now()}`,
          name: 'API062 Self',
          sortOrder: 88,
          isActive: false,
        })
        .returning();
      catIds.push(category.id);

      const [exp] = await db
        .insert(experiences)
        .values({
          ownerUserId: userId,
          categoryId: category.id,
          organization: 'Self Org',
          position: 'Self Position',
          startDate: new Date('2023-02-02'),
          endDate: null,
          dutiesNarrative: 'Self work.',
          totalHours: 10,
          hoursPerWeek: 2,
          numberOfWeeks: 5,
        })
        .returning();
      expIds.push(exp.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/export`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const lines = res.body.split('\r\n');
      expect(lines[0]).toBe(EXPECTED_HEADER);
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('Self Org');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('GET /api/experiences/export — integration (CSV escaping)', () => {
  it('wraps a field containing a comma and a quote correctly', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api062-escape+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api062-cat-esc-${Date.now()}`,
          name: 'API062 Esc',
          sortOrder: 77,
          isActive: false,
        })
        .returning();
      catIds.push(category.id);

      const [exp] = await db
        .insert(experiences)
        .values({
          ownerUserId: userId,
          categoryId: category.id,
          organization: 'Smith, Jones & "Co"',
          position: 'Analyst',
          startDate: new Date('2023-03-03'),
          endDate: null,
          dutiesNarrative: 'Escaping work.',
          totalHours: 10,
          hoursPerWeek: 2,
          numberOfWeeks: 5,
        })
        .returning();
      expIds.push(exp.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/export?owner_user_id=${userId}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      // Comma → wrapped in quotes; embedded quote → doubled.
      expect(res.body).toContain('"Smith, Jones & ""Co"""');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('GET /api/experiences/export — integration (forbidden)', () => {
  it('returns 403 when an applicant requests another user owner_user_id', async () => {
    const app = await buildApp();
    try {
      const ownerEmail = `api062-owner2+${Date.now()}@example.com`;
      const callerEmail = `api062-caller+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const callerCookie = await signUpAndGetSession(app, callerEmail);
      const ownerId = await getUserId(ownerEmail);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/export?owner_user_id=${ownerId}`,
        headers: { cookie: callerCookie },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/experiences/export — integration (admin)', () => {
  it('returns 200 when an admin exports an arbitrary owner_user_id', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const adminIds: string[] = [];
    try {
      const ownerEmail = `api062-owner3+${Date.now()}@example.com`;
      const adminEmail = `api062-admin+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const adminCookie = await signUpAndGetSession(app, adminEmail);
      const ownerId = await getUserId(ownerEmail);
      const adminId = await getUserId(adminEmail);

      await db.insert(systemRoles).values({ userId: adminId, role: 'admin' });
      adminIds.push(adminId);

      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api062-cat-admin-${Date.now()}`,
          name: 'API062 Admin',
          sortOrder: 66,
          isActive: false,
        })
        .returning();
      catIds.push(category.id);

      const [exp] = await db
        .insert(experiences)
        .values({
          ownerUserId: ownerId,
          categoryId: category.id,
          organization: 'Admin-Visible Org',
          position: 'Position',
          startDate: new Date('2023-04-04'),
          endDate: null,
          dutiesNarrative: 'Work.',
          totalHours: 10,
          hoursPerWeek: 2,
          numberOfWeeks: 5,
        })
        .returning();
      expIds.push(exp.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/export?owner_user_id=${ownerId}`,
        headers: { cookie: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.body).toContain('Admin-Visible Org');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      for (const id of adminIds) await db.delete(systemRoles).where(eq(systemRoles.userId, id));
      await app.close();
    }
  });
});
