/**
 * Integration tests for API-059 — flag workflow API.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Harness modelled on api-033.integration.test.ts / api-057.integration.test.ts.
 *
 * Covers (API-059 Tests):
 * - Reviewer with an active mentor grant over the experience owner can POST a
 *   flag: 201, row exists with status 'open'.
 * - Reviewer without a grant → 403; POST against a non-existent experience ID
 *   also → 403, not 404 (non-disclosure, CER-035 precedent).
 * - reason > 1024 chars → 400.
 * - GET /api/admin/flags requires the admin role (403 for non-admin) and
 *   honours ?status= filter and limit/offset pagination.
 * - PATCH /api/admin/flags/:id as admin resolves the flag (status,
 *   resolved_by_user_id, resolved_at set); non-admin → 403.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  flagReport,
  mentorGrants,
  systemRoles,
  users,
} from '../src/db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name, email, password: 'Password123!' }),
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

describe('API-059 flag workflow (integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const applicantEmail = `api059-applicant+${ts}@example.com`;
  const reviewerEmail = `api059-reviewer+${ts}@example.com`;
  const strangerEmail = `api059-stranger+${ts}@example.com`;
  const adminEmail = `api059-admin+${ts}@example.com`;

  let applicantCookie: string;
  let reviewerCookie: string;
  let strangerCookie: string;
  let adminCookie: string;

  let applicantId: string;
  let reviewerId: string;
  let adminId: string;

  let categoryId: string;
  let experienceId: string;
  let secondExperienceId: string;
  const grantId = `api059-grant-${ts}`;

  beforeAll(async () => {
    app = await buildApp();

    applicantCookie = await signUpAndGetSession(app, applicantEmail, 'Applicant Ann');
    reviewerCookie = await signUpAndGetSession(app, reviewerEmail, 'Reviewer Ray');
    strangerCookie = await signUpAndGetSession(app, strangerEmail, 'Stranger Sam');
    adminCookie = await signUpAndGetSession(app, adminEmail, 'Admin Ada');
    void applicantCookie;

    applicantId = await getUserId(applicantEmail);
    reviewerId = await getUserId(reviewerEmail);
    adminId = await getUserId(adminEmail);

    await db.insert(systemRoles).values({ userId: adminId, role: 'admin' }).onConflictDoNothing();

    const [category] = await db
      .insert(experienceCategories)
      .values({ slug: `api059-cat-${ts}`, name: 'API059 Category', sortOrder: 99, isActive: true })
      .returning();
    categoryId = category.id;

    const [exp] = await db
      .insert(experiences)
      .values({
        ownerUserId: applicantId,
        categoryId,
        organization: 'Flaggable Org',
        position: 'Flaggable Position',
        startDate: new Date('2023-01-01'),
        dutiesNarrative: 'Did flaggable work.',
        totalHours: 40,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
      })
      .returning();
    experienceId = exp.id;

    const [exp2] = await db
      .insert(experiences)
      .values({
        ownerUserId: applicantId,
        categoryId,
        organization: 'Second Org',
        position: 'Second Position',
        startDate: new Date('2023-02-01'),
        dutiesNarrative: 'More flaggable work.',
        totalHours: 20,
        hoursPerWeek: 4,
        numberOfWeeks: 5,
      })
      .returning();
    secondExperienceId = exp2.id;

    // Reviewer holds an active 'read' grant over the applicant. Stranger holds none.
    await db.insert(mentorGrants).values({
      id: grantId,
      applicantUserId: applicantId,
      mentorUserId: reviewerId,
      grantedByUserId: applicantId,
      status: 'active',
      permissions: ['read'],
    });
  });

  afterAll(async () => {
    await db.delete(flagReport).where(eq(flagReport.reviewerUserId, reviewerId));
    await db.delete(mentorGrants).where(eq(mentorGrants.id, grantId));
    await db
      .delete(experiences)
      .where(inArray(experiences.id, [experienceId, secondExperienceId]));
    await db.delete(experienceCategories).where(eq(experienceCategories.id, categoryId));
    await app.close();
  });

  it('unauthenticated POST → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/experiences/${experienceId}/flag`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'Suspicious hours' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('reviewer with an active grant can POST a flag → 201, row exists with status open', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/experiences/${experienceId}/flag`,
      headers: { 'content-type': 'application/json', cookie: reviewerCookie },
      payload: JSON.stringify({ reason: 'Hours look inflated' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string; reason: string };
    expect(body.status).toBe('open');
    expect(body.reason).toBe('Hours look inflated');

    const rows = await db.select().from(flagReport).where(eq(flagReport.id, body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('open');
    expect(rows[0].reviewerUserId).toBe(reviewerId);
    expect(rows[0].experienceId).toBe(experienceId);
  });

  it('reviewer without a grant → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/experiences/${experienceId}/flag`,
      headers: { 'content-type': 'application/json', cookie: strangerCookie },
      payload: JSON.stringify({ reason: 'No grant here' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST against a non-existent experience ID → 403, not 404 (non-disclosure)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences/00000000-0000-0000-0000-000000000000/flag',
      headers: { 'content-type': 'application/json', cookie: reviewerCookie },
      payload: JSON.stringify({ reason: 'Ghost experience' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('reason over 1024 characters → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/experiences/${experienceId}/flag`,
      headers: { 'content-type': 'application/json', cookie: reviewerCookie },
      payload: JSON.stringify({ reason: 'x'.repeat(1025) }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/admin/flags — 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flags',
      headers: { cookie: reviewerCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/admin/flags — admin sees the flag with experience + reviewer joins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flags?status=open',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{
      experienceId: string;
      status: string;
      organization: string | null;
      position: string | null;
      ownerUserId: string | null;
      reviewerName: string | null;
      reviewerEmail: string | null;
    }>;
    const mine = rows.find((r) => r.experienceId === experienceId);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe('open');
    expect(mine!.organization).toBe('Flaggable Org');
    expect(mine!.position).toBe('Flaggable Position');
    expect(mine!.ownerUserId).toBe(applicantId);
    expect(mine!.reviewerName).toBe('Reviewer Ray');
    expect(mine!.reviewerEmail).toBe(reviewerEmail);
  });

  it('GET /api/admin/flags — honours ?status= filter and pagination', async () => {
    // Flag the second experience so at least two open flags exist for this reviewer.
    const create = await app.inject({
      method: 'POST',
      url: `/api/experiences/${secondExperienceId}/flag`,
      headers: { 'content-type': 'application/json', cookie: reviewerCookie },
      payload: JSON.stringify({ reason: 'Second concern' }),
    });
    expect(create.statusCode).toBe(201);

    // status=resolved excludes both open flags.
    const resolved = await app.inject({
      method: 'GET',
      url: '/api/admin/flags?status=resolved',
      headers: { cookie: adminCookie },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedRows = resolved.json() as Array<{ experienceId: string }>;
    expect(
      resolvedRows.filter(
        (r) => r.experienceId === experienceId || r.experienceId === secondExperienceId,
      ),
    ).toHaveLength(0);

    // limit=1 returns exactly one row; offset=1 returns a different first row.
    const page1 = await app.inject({
      method: 'GET',
      url: '/api/admin/flags?status=open&limit=1&offset=0',
      headers: { cookie: adminCookie },
    });
    expect(page1.statusCode).toBe(200);
    const page1Rows = page1.json() as Array<{ id: string }>;
    expect(page1Rows).toHaveLength(1);

    const page2 = await app.inject({
      method: 'GET',
      url: '/api/admin/flags?status=open&limit=1&offset=1',
      headers: { cookie: adminCookie },
    });
    expect(page2.statusCode).toBe(200);
    const page2Rows = page2.json() as Array<{ id: string }>;
    expect(page2Rows).toHaveLength(1);
    expect(page2Rows[0].id).not.toBe(page1Rows[0].id);
  });

  it('PATCH /api/admin/flags/:id — 403 for non-admin', async () => {
    const rows = await db
      .select()
      .from(flagReport)
      .where(eq(flagReport.experienceId, experienceId));
    expect(rows.length).toBeGreaterThan(0);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/flags/${rows[0].id}`,
      headers: { cookie: reviewerCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /api/admin/flags/:id — admin resolves the flag', async () => {
    const rows = await db
      .select()
      .from(flagReport)
      .where(eq(flagReport.experienceId, experienceId));
    const flagId = rows[0].id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/flags/${flagId}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      resolvedByUserId: string | null;
      resolvedAt: string | null;
    };
    expect(body.status).toBe('resolved');
    expect(body.resolvedByUserId).toBe(adminId);
    expect(body.resolvedAt).not.toBeNull();

    const [dbRow] = await db.select().from(flagReport).where(eq(flagReport.id, flagId));
    expect(dbRow.status).toBe('resolved');
    expect(dbRow.resolvedByUserId).toBe(adminId);
    expect(dbRow.resolvedAt).not.toBeNull();
  });

  it('PATCH /api/admin/flags/:id — 404 for a non-existent flag id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/flags/00000000-0000-0000-0000-000000000000',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
