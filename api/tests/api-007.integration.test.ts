/**
 * Integration tests for GET /api/experiences (API-007).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - Owner calling with their own owner_user_id → 200 with full list
 *   - Non-owner without a mentor grant → 403
 *   - Mentor with read grant → 200 with PII gated for experiences
 *     where permission_to_contact = false
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
    payload: JSON.stringify({ name: 'API-007 User', email, password: 'Password123!' }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/experiences — integration (owner)', () => {
  it('returns 200 with full experience list when caller is the owner', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api007-owner+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api007-cat-${Date.now()}`,
          name: 'API007 Category',
          sortOrder: 99,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      // Seed an experience with contact PII and permission_to_contact = true
      const [exp] = await db
        .insert(experiences)
        .values({
          ownerUserId: userId,
          categoryId: category.id,
          organization: 'Test Org',
          position: 'Test Position',
          startDate: new Date('2023-01-01'),
          endDate: null,
          dutiesNarrative: 'Did some work.',
          totalHours: 40,
          hoursPerWeek: 8,
          numberOfWeeks: 5,
          permissionToContact: true,
          contactFirstName: 'Jane',
          contactLastName: 'Doe',
          contactEmail: 'jane@example.com',
        })
        .returning();
      expIds.push(exp.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences?owner_user_id=${userId}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Owner gets full PII
      const found = body.find((e) => e['id'] === exp.id);
      expect(found).toBeDefined();
      expect(found!['contactFirstName']).toBe('Jane');
      expect(found!['contactLastName']).toBe('Doe');
      expect(found!['contactEmail']).toBe('jane@example.com');
    } finally {
      // Clean up experiences before categories (FK constraint)
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('GET /api/experiences — integration (forbidden)', () => {
  it('returns 403 when caller is not the owner and has no mentor grant', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const ownerEmail = `api007-owner2+${Date.now()}@example.com`;
      const callerEmail = `api007-caller+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const callerCookie = await signUpAndGetSession(app, callerEmail);

      const ownerId = await getUserId(ownerEmail);

      // Seed a category and experience so the owner has data
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api007-cat2-${Date.now()}`,
          name: 'API007 Cat2',
          sortOrder: 98,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      const [exp] = await db
        .insert(experiences)
        .values({
          ownerUserId: ownerId,
          categoryId: category.id,
          organization: 'Forbidden Org',
          position: 'Forbidden Position',
          startDate: new Date('2023-03-01'),
          endDate: null,
          dutiesNarrative: 'Forbidden work.',
          totalHours: 10,
          hoursPerWeek: 2,
          numberOfWeeks: 5,
          permissionToContact: false,
        })
        .returning();
      expIds.push(exp.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences?owner_user_id=${ownerId}`,
        headers: { cookie: callerCookie },
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

describe('GET /api/experiences — integration (mentor grant + PII gate)', () => {
  it('returns 200 with PII gated when caller has read grant and experience has permission_to_contact=false', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const ownerEmail = `api007-owner3+${Date.now()}@example.com`;
      const mentorEmail = `api007-mentor+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const ownerId = await getUserId(ownerEmail);
      const mentorId = await getUserId(mentorEmail);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api007-cat3-${Date.now()}`,
          name: 'API007 Cat3',
          sortOrder: 97,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      // Seed an experience with contact PII but permission_to_contact = false
      const [hiddenExp] = await db
        .insert(experiences)
        .values({
          ownerUserId: ownerId,
          categoryId: category.id,
          organization: 'Secret Org',
          position: 'Secret Position',
          startDate: new Date('2022-06-01'),
          endDate: null,
          dutiesNarrative: 'Confidential work.',
          totalHours: 20,
          hoursPerWeek: 4,
          numberOfWeeks: 5,
          permissionToContact: false,
          contactFirstName: 'Bob',
          contactLastName: 'Smith',
          contactEmail: 'bob@example.com',
        })
        .returning();
      expIds.push(hiddenExp.id);

      // Seed an experience with permission_to_contact = true
      const [visibleExp] = await db
        .insert(experiences)
        .values({
          ownerUserId: ownerId,
          categoryId: category.id,
          organization: 'Open Org',
          position: 'Open Position',
          startDate: new Date('2022-07-01'),
          endDate: null,
          dutiesNarrative: 'Public work.',
          totalHours: 30,
          hoursPerWeek: 6,
          numberOfWeeks: 5,
          permissionToContact: true,
          contactFirstName: 'Carol',
          contactLastName: 'Jones',
          contactEmail: 'carol@example.com',
        })
        .returning();
      expIds.push(visibleExp.id);

      // Create a mentor grant with 'read' permission
      const grantId = `api007-grant-${Date.now()}`;
      await db.insert(mentorGrants).values({
        id: grantId,
        applicantUserId: ownerId,
        mentorUserId: mentorId,
        grantedByUserId: ownerId,
        status: 'active',
        permissions: ['read'],
      });
      grantIds.push(grantId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences?owner_user_id=${ownerId}`,
        headers: { cookie: mentorCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Experience with permission_to_contact = false → contact fields gated
      const hidden = body.find((e) => e['id'] === hiddenExp.id);
      expect(hidden).toBeDefined();
      expect(hidden!['contactFirstName']).toBeNull();
      expect(hidden!['contactLastName']).toBeNull();
      expect(hidden!['contactEmail']).toBeNull();
      expect(hidden!['contactPhone']).toBeNull();
      expect(hidden!['contactTitle']).toBeNull();

      // Experience with permission_to_contact = true → contact fields visible
      const visible = body.find((e) => e['id'] === visibleExp.id);
      expect(visible).toBeDefined();
      expect(visible!['contactFirstName']).toBe('Carol');
      expect(visible!['contactLastName']).toBe('Jones');
      expect(visible!['contactEmail']).toBe('carol@example.com');
    } finally {
      // Clean up: grants → experiences → categories (FK order)
      for (const id of grantIds) {
        await db.delete(mentorGrants).where(eq(mentorGrants.id, id));
      }
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
