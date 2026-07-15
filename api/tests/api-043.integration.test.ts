/**
 * Integration tests for GET /api/mentor/talent-pool (API-043).
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Setup helpers modelled on api-040.integration.test.ts.
 *
 * Covers (API-043 Ensures / Tests):
 * - Mentor with an active grant over applicants A and B → 200; response has
 *   entries for A and B only, each with categories, summed experienceCount /
 *   verifiedCount, and activeCategoryCount.
 * - Applicant C granted to a DIFFERENT mentor is absent (no cross-mentor leakage).
 * - An applicant who also holds the `admin` role is excluded from the pool.
 * - verifiedCount reflects only verification_status = 'verified'; totalHours per
 *   category equals the applicant's summed category hours.
 * - shortlisted / starRating default to false / null with no row, reflect the
 *   caller's own row when inserted, and are NOT affected by a different
 *   reviewer's row for the same applicant.
 * - Unauthenticated request → 401.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  mentorGrants,
  systemRoles,
  interviewShortlist,
  users,
} from '../src/db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-043 User', email, password: 'Password123!' }),
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

interface TalentEntry {
  applicantUserId: string;
  applicantName: string;
  applicantEmail: string;
  categories: {
    categoryId: string;
    categorySlug: string;
    categoryName: string;
    totalHours: number;
    experienceCount: number;
    verifiedCount: number;
  }[];
  experienceCount: number;
  verifiedCount: number;
  activeCategoryCount: number;
  shortlisted: boolean;
  starRating: number | null;
}

describe('GET /api/mentor/talent-pool (API-043 integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const mentorEmail = `api043-mentor+${ts}@example.com`;
  const otherMentorEmail = `api043-other-mentor+${ts}@example.com`;
  const reviewerBEmail = `api043-reviewer-b+${ts}@example.com`;
  const appAEmail = `api043-app-a+${ts}@example.com`;
  const appBEmail = `api043-app-b+${ts}@example.com`;
  const appCEmail = `api043-app-c+${ts}@example.com`;
  const appAdminEmail = `api043-app-admin+${ts}@example.com`;

  let mentorCookie: string;

  let mentorId: string;
  let otherMentorId: string;
  let reviewerBId: string;
  let appAId: string;
  let appBId: string;
  let appCId: string;
  let appAdminId: string;

  let cat1Id: string;
  let cat2Id: string;
  const insertedExpIds: string[] = [];
  const grantIds = [
    `api043-grant-a-${ts}`,
    `api043-grant-b-${ts}`,
    `api043-grant-c-${ts}`,
    `api043-grant-admin-${ts}`,
  ];

  beforeAll(async () => {
    app = await buildApp();

    mentorCookie = await signUpAndGetSession(app, mentorEmail);
    await signUpAndGetSession(app, otherMentorEmail);
    await signUpAndGetSession(app, reviewerBEmail);
    await signUpAndGetSession(app, appAEmail);
    await signUpAndGetSession(app, appBEmail);
    await signUpAndGetSession(app, appCEmail);
    await signUpAndGetSession(app, appAdminEmail);

    mentorId = await getUserId(mentorEmail);
    otherMentorId = await getUserId(otherMentorEmail);
    reviewerBId = await getUserId(reviewerBEmail);
    appAId = await getUserId(appAEmail);
    appBId = await getUserId(appBEmail);
    appCId = await getUserId(appCEmail);
    appAdminId = await getUserId(appAdminEmail);

    // appAdmin holds the admin system role → must be excluded from the pool.
    await db.insert(systemRoles).values({ userId: appAdminId, role: 'admin' });

    const [c1] = await db
      .insert(experienceCategories)
      .values({ slug: `api043-cat1-${ts}`, name: 'API043 Cat 1', sortOrder: 1, isActive: true })
      .returning();
    cat1Id = c1.id;
    const [c2] = await db
      .insert(experienceCategories)
      .values({ slug: `api043-cat2-${ts}`, name: 'API043 Cat 2', sortOrder: 2, isActive: true })
      .returning();
    cat2Id = c2.id;

    async function seedExp(
      ownerUserId: string,
      categoryId: string,
      totalHours: number,
      verified: boolean,
    ): Promise<void> {
      const hoursPerWeek = totalHours / 5;
      const [row] = await db
        .insert(experiences)
        .values({
          ownerUserId,
          categoryId,
          organization: 'Org',
          position: 'Role',
          startDate: new Date('2024-01-01'),
          dutiesNarrative: 'Duties for API-043 integration test.',
          totalHours,
          hoursPerWeek,
          numberOfWeeks: 5,
          verificationStatus: verified ? 'verified' : 'unverified',
          verifiedByUserId: verified ? mentorId : null,
          verifiedAt: verified ? new Date() : null,
        })
        .returning();
      insertedExpIds.push(row.id);
    }

    // Applicant A: cat1 → 40 (verified) + 60 (unverified); cat2 → 30 (verified).
    await seedExp(appAId, cat1Id, 40, true);
    await seedExp(appAId, cat1Id, 60, false);
    await seedExp(appAId, cat2Id, 30, true);

    // Applicant B: cat1 → 50 (verified).
    await seedExp(appBId, cat1Id, 50, true);

    // Applicant C (granted to a different mentor): cat1 → 100.
    await seedExp(appCId, cat1Id, 100, true);

    // Applicant Admin: cat1 → 20 (should never surface).
    await seedExp(appAdminId, cat1Id, 20, true);

    // Active grants from the caller over A, B, and Admin.
    await db.insert(mentorGrants).values([
      {
        id: grantIds[0],
        applicantUserId: appAId,
        mentorUserId: mentorId,
        grantedByUserId: mentorId,
        status: 'active',
        permissions: ['read'],
      },
      {
        id: grantIds[1],
        applicantUserId: appBId,
        mentorUserId: mentorId,
        grantedByUserId: mentorId,
        status: 'active',
        permissions: ['read'],
      },
      {
        id: grantIds[3],
        applicantUserId: appAdminId,
        mentorUserId: mentorId,
        grantedByUserId: mentorId,
        status: 'active',
        permissions: ['read'],
      },
    ]);

    // Applicant C granted to a DIFFERENT mentor → must not leak to the caller.
    await db.insert(mentorGrants).values({
      id: grantIds[2],
      applicantUserId: appCId,
      mentorUserId: otherMentorId,
      grantedByUserId: otherMentorId,
      status: 'active',
      permissions: ['read'],
    });

    // Caller's own shortlist row for A: shortlisted + 4 stars.
    await db.insert(interviewShortlist).values({
      reviewerUserId: mentorId,
      applicantUserId: appAId,
      shortlisted: true,
      starRating: 4,
    });

    // A DIFFERENT reviewer's row for applicant B — must NOT affect the caller.
    await db.insert(interviewShortlist).values({
      reviewerUserId: reviewerBId,
      applicantUserId: appBId,
      shortlisted: true,
      starRating: 1,
    });
  });

  afterAll(async () => {
    await db.delete(interviewShortlist).where(inArray(interviewShortlist.reviewerUserId, [mentorId, reviewerBId]));
    await db.delete(mentorGrants).where(inArray(mentorGrants.id, grantIds));
    await db.delete(experiences).where(inArray(experiences.id, insertedExpIds));
    await db.delete(experienceCategories).where(inArray(experienceCategories.id, [cat1Id, cat2Id]));
    await db.delete(systemRoles).where(eq(systemRoles.userId, appAdminId));
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/mentor/talent-pool' });
    expect(res.statusCode).toBe(401);
  });

  it('returns only granted, non-admin applicants with rollup + shortlist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor/talent-pool',
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TalentEntry[];

    const ids = body.map((e) => e.applicantUserId).sort();
    expect(ids).toEqual([appAId, appBId].sort());
    // No cross-mentor leakage (C) and admin excluded.
    expect(ids).not.toContain(appCId);
    expect(ids).not.toContain(appAdminId);

    const a = body.find((e) => e.applicantUserId === appAId)!;
    // Two active categories, zero-filled.
    expect(a.activeCategoryCount).toBe(2);
    expect(a.categories).toHaveLength(2);

    const a1 = a.categories.find((c) => c.categoryId === cat1Id)!;
    const a2 = a.categories.find((c) => c.categoryId === cat2Id)!;
    // cat1: 40 + 60 = 100 hours, 2 experiences, 1 verified.
    expect(a1.totalHours).toBe(100);
    expect(a1.experienceCount).toBe(2);
    expect(a1.verifiedCount).toBe(1);
    // cat2: 30 hours, 1 experience, 1 verified.
    expect(a2.totalHours).toBe(30);
    expect(a2.experienceCount).toBe(1);
    expect(a2.verifiedCount).toBe(1);

    // Summed totals across categories.
    expect(a.experienceCount).toBe(3);
    expect(a.verifiedCount).toBe(2);

    // Caller's own shortlist row.
    expect(a.shortlisted).toBe(true);
    expect(a.starRating).toBe(4);
  });

  it('shortlist defaults to false/null and ignores a different reviewer row', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor/talent-pool',
      headers: { cookie: mentorCookie },
    });
    const body = res.json() as TalentEntry[];
    const b = body.find((e) => e.applicantUserId === appBId)!;
    // reviewerB shortlisted B with 1 star — the caller has no row of their own.
    expect(b.shortlisted).toBe(false);
    expect(b.starRating).toBeNull();
  });
});
