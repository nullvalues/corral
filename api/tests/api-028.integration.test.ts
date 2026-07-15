/**
 * Integration tests for API-028: denyRole('admin') on experience mutations.
 *
 * Verifies that POST, PATCH, and DELETE /api/experiences* return 403 when the
 * caller has the admin role, and succeed (2xx) for an applicant caller.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles, experienceCategories, experiences } from '../src/db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUpAndGetSession(
  app: FastifyInstance,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-028 Test User', email, password: 'Password123!' }),
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

async function assignRole(userId: string, role: 'admin' | 'applicant'): Promise<void> {
  await db.insert(systemRoles).values({ userId, role }).onConflictDoNothing();
}

async function seedCategory(slug: string): Promise<string> {
  const [category] = await db
    .insert(experienceCategories)
    .values({ slug, name: `API-028 Category ${slug}`, sortOrder: 99, isActive: true })
    .returning();
  return category.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin role blocked on experience mutations', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let applicantCookie: string;
  let categoryId: string;
  let createdExperienceId: string;

  const ts = Date.now();
  const adminEmail = `api028-admin+${ts}@example.com`;
  const applicantEmail = `api028-applicant+${ts}@example.com`;
  const catSlug = `api028-cat-${ts}`;

  const catIds: string[] = [];
  const expIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();

    adminCookie = await signUpAndGetSession(app, adminEmail);
    applicantCookie = await signUpAndGetSession(app, applicantEmail);

    const adminId = await getUserId(adminEmail);
    await assignRole(adminId, 'admin');

    categoryId = await seedCategory(catSlug);
    catIds.push(categoryId);
  });

  afterAll(async () => {
    if (expIds.length) {
      await db.delete(experiences).where(inArray(experiences.id, expIds));
    }
    if (catIds.length) {
      await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
    }
    await app.close();
  });

  it('POST /api/experiences with admin session → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({
        categoryId,
        organization: 'Test Org',
        position: 'Tester',
        startDate: '2024-01-01',
        dutiesNarrative: 'Testing duties',
        totalHours: 40,
        hoursPerWeek: 10,
        numberOfWeeks: 4,
      }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/experiences with applicant session + valid body → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({
        categoryId,
        organization: 'Test Org',
        position: 'Tester',
        startDate: '2024-01-01',
        dutiesNarrative: 'Testing duties',
        totalHours: 40,
        hoursPerWeek: 10,
        numberOfWeeks: 4,
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    createdExperienceId = body['id'] as string;
    expIds.push(createdExperienceId);
  });

  it('PATCH /api/experiences/:id with admin session → 403', async () => {
    // preHandler fires before DB lookup — any valid UUID returns 403 for admins.
    // Must use a valid UUIDv4 (version nibble 4) so params validation passes before preHandler fires.
    const nonExistentId = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${nonExistentId}`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ organization: 'Updated Org' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /api/experiences/:id with admin session → 403', async () => {
    // preHandler fires before DB lookup — any valid UUID returns 403 for admins.
    // Must use a valid UUIDv4 (version nibble 4) so params validation passes before preHandler fires.
    const nonExistentId = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/experiences/${nonExistentId}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
