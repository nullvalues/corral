/**
 * Integration tests for GET /api/experiences/:id (API-008).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - Owner gets 200 with full fields for an experience they own
 *   - Mentor with read grant gets 200 with PII gated when permissionToContact=false
 *   - Third-party (no grant) gets 403
 *   - Owner requesting a non-existent UUID gets 403 (ownership cannot be determined
 *     without the row — the sentinel '' fails the ABAC check, consistent with
 *     not leaking existence for any caller)
 *   - Third-party requesting non-existent UUID gets 403 (must not leak existence)
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
    payload: JSON.stringify({ name: 'API-008 User', email, password: 'Password123!' }),
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

describe('GET /api/experiences/:id — integration (owner)', () => {
  it('returns 200 with full fields when caller is the owner', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const email = `api008-owner+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);
      const userId = await getUserId(email);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api008-cat-${Date.now()}`,
          name: 'API008 Category',
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
        url: `/api/experiences/${exp.id}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['id']).toBe(exp.id);
      // Owner gets full PII
      expect(body['contactFirstName']).toBe('Jane');
      expect(body['contactLastName']).toBe('Doe');
      expect(body['contactEmail']).toBe('jane@example.com');
      expect(body['organization']).toBe('Test Org');
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length) await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});

describe('GET /api/experiences/:id — integration (mentor + PII gate)', () => {
  it('returns 200 with PII gated when caller has read grant and permissionToContact=false', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const grantIds: string[] = [];
    try {
      const ownerEmail = `api008-owner2+${Date.now()}@example.com`;
      const mentorEmail = `api008-mentor+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const mentorCookie = await signUpAndGetSession(app, mentorEmail);

      const ownerId = await getUserId(ownerEmail);
      const mentorId = await getUserId(mentorEmail);

      // Seed a category
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api008-cat2-${Date.now()}`,
          name: 'API008 Cat2',
          sortOrder: 98,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      // Seed an experience with contact PII but permission_to_contact = false
      const [exp] = await db
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
      expIds.push(exp.id);

      // Create a mentor grant with 'read' permission
      const grantId = `api008-grant-${Date.now()}`;
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
        url: `/api/experiences/${exp.id}`,
        headers: { cookie: mentorCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['id']).toBe(exp.id);
      // PII gated because permissionToContact = false
      expect(body['contactFirstName']).toBeNull();
      expect(body['contactLastName']).toBeNull();
      expect(body['contactEmail']).toBeNull();
      expect(body['contactPhone']).toBeNull();
      expect(body['contactTitle']).toBeNull();
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

describe('GET /api/experiences/:id — integration (third-party forbidden)', () => {
  it('returns 403 when caller has no grant for the experience', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const ownerEmail = `api008-owner3+${Date.now()}@example.com`;
      const callerEmail = `api008-caller+${Date.now()}@example.com`;

      await signUpAndGetSession(app, ownerEmail);
      const callerCookie = await signUpAndGetSession(app, callerEmail);

      const ownerId = await getUserId(ownerEmail);

      // Seed a category and experience
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `api008-cat3-${Date.now()}`,
          name: 'API008 Cat3',
          sortOrder: 97,
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
        url: `/api/experiences/${exp.id}`,
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

describe('GET /api/experiences/:id — integration (non-existent experience)', () => {
  it('returns 403 for any caller when experience does not exist (no existence leak)', async () => {
    const app = await buildApp();
    try {
      const email = `api008-owner4+${Date.now()}@example.com`;
      const sessionCookie = await signUpAndGetSession(app, email);

      // Non-existent UUID — ownership cannot be determined without the row,
      // so the sentinel '' fails the ABAC check → 403 for everyone.
      const nonExistentId = '00000000-0000-4000-a000-000000000001';

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/${nonExistentId}`,
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 403 for third-party when experience does not exist (must not leak existence)', async () => {
    const app = await buildApp();
    try {
      const callerEmail = `api008-caller2+${Date.now()}@example.com`;
      const callerCookie = await signUpAndGetSession(app, callerEmail);

      const nonExistentId = '00000000-0000-4000-a000-000000000002';

      const res = await app.inject({
        method: 'GET',
        url: `/api/experiences/${nonExistentId}`,
        headers: { cookie: callerCookie },
      });

      // Third-party always gets 403, even if the exp doesn't exist (no existence leak)
      expect(res.statusCode).toBe(403);
      const body = res.json() as Record<string, unknown>;
      expect(body['error']).toBe('Forbidden');
    } finally {
      await app.close();
    }
  });
});
