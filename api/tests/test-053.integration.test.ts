/**
 * TEST-053 — Shortlist ABAC isolation and ranking integration tests.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Harness modelled on api-040.integration.test.ts / api-043.integration.test.ts.
 *
 * Covers (TEST-053 Ensures — broad functional integration):
 *
 * 1. Shortlist isolation end-to-end (read-back via talent-pool):
 *    M1 and M2 both hold active grants over the SAME applicant A. M1 PATCHes
 *    { shortlisted: true, starRating: 5 }; M2 PATCHes { shortlisted: false,
 *    starRating: 1 }. After both writes, M1's GET /api/mentor/talent-pool entry
 *    for A shows starRating: 5 and M2's shows starRating: 1 — two distinct
 *    interview_shortlist rows, neither write overwrote the other.
 *
 * 2. Talent-pool ranking components:
 *    Two applicants with different experiences: A (broad — all-verified, two
 *    categories) and B (narrow — mostly unverified, single category). The API
 *    response returns per-category totalHours / experienceCount / verifiedCount,
 *    summed totals, and activeCategoryCount. Asserts those raw components, then
 *    applies the same default-weight formula as readiness.ts inline to confirm
 *    A (readiness=40) ranks strictly above B (readiness=20) — no persisted score.
 *
 * 3. Non-grant rejection:
 *    A mentor without a grant over applicant A receives 403 from
 *    PATCH /api/mentor/applicants/A/review, and no interview_shortlist row exists
 *    for that (mentor, A) pair.
 *
 * Seed layout:
 *   Users: M1, M2, noGrantMentor, appA, appB.
 *   Categories: cat1, cat2 (both active; arbitrary slugs — no VMCAS goalHours match).
 *   appA (broad):  cat1 → 2 verified (100 + 50 = 150 hrs); cat2 → 1 verified (80 hrs).
 *   appB (narrow): cat1 → 1 verified (60 hrs) + 1 unverified (40 hrs).
 *   Grants: M1→A (read+write), M1→B (read+write), M2→A (read+write).
 *   noGrantMentor holds NO grants.
 *
 * Inline readiness formula (no goalHours for test slugs → goalProgress = 0):
 *   score = 0.25 * verifiedRatio + 0.15 * breadth
 *   appA: verifiedRatio=3/3=1, breadth=2/2=1 → round(100*0.40) = 40
 *   appB: verifiedRatio=1/2=0.5, breadth=1/2=0.5 → round(100*0.20) = 20
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  mentorGrants,
  interviewShortlist,
  users,
} from '../src/db/schema/index.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers (same pattern as api-043.integration.test.ts)
// ---------------------------------------------------------------------------

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'T053 User', email, password: 'Password123!' }),
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

// Inline readiness computation (default weights; goalProgress = 0 for slugs with no VMCAS goal).
// Mirrors the formula in ui/src/lib/readiness.ts without importing across packages.
function inlineReadiness(entry: {
  experienceCount: number;
  verifiedCount: number;
  activeCategoryCount: number;
  categories: { experienceCount: number }[];
}): number {
  const W_VERIFIED = 0.25;
  const W_BREADTH = 0.15;
  const verifiedRatio = entry.verifiedCount / Math.max(1, entry.experienceCount);
  const populated = entry.categories.filter((c) => c.experienceCount > 0).length;
  const breadth = populated / Math.max(1, entry.activeCategoryCount);
  return Math.round(100 * (W_VERIFIED * verifiedRatio + W_BREADTH * breadth));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TEST-053 — Shortlist ABAC isolation and ranking integration', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const m1Email = `t053-m1+${ts}@example.com`;
  const m2Email = `t053-m2+${ts}@example.com`;
  const noGrantEmail = `t053-nogrant+${ts}@example.com`;
  const appAEmail = `t053-app-a+${ts}@example.com`;
  const appBEmail = `t053-app-b+${ts}@example.com`;

  let m1Cookie: string;
  let m2Cookie: string;
  let noGrantCookie: string;

  let m1Id: string;
  let m2Id: string;
  let noGrantId: string;
  let appAId: string;
  let appBId: string;

  let cat1Id: string;
  let cat2Id: string;
  const insertedExpIds: string[] = [];
  const grantIds = [
    `t053-grant-m1a-${ts}`,
    `t053-grant-m1b-${ts}`,
    `t053-grant-m2a-${ts}`,
  ];

  beforeAll(async () => {
    app = await buildApp();

    // Sign up all accounts and capture sessions
    m1Cookie = await signUpAndGetSession(app, m1Email);
    m2Cookie = await signUpAndGetSession(app, m2Email);
    noGrantCookie = await signUpAndGetSession(app, noGrantEmail);
    await signUpAndGetSession(app, appAEmail);
    await signUpAndGetSession(app, appBEmail);

    // Resolve IDs
    m1Id = await getUserId(m1Email);
    m2Id = await getUserId(m2Email);
    noGrantId = await getUserId(noGrantEmail);
    appAId = await getUserId(appAEmail);
    appBId = await getUserId(appBEmail);

    // Two active categories (arbitrary slugs — no VMCAS goalHours match → goalProgress = 0)
    const [c1] = await db
      .insert(experienceCategories)
      .values({ slug: `t053-cat1-${ts}`, name: 'T053 Cat1', sortOrder: 1, isActive: true })
      .returning();
    cat1Id = c1.id;
    const [c2] = await db
      .insert(experienceCategories)
      .values({ slug: `t053-cat2-${ts}`, name: 'T053 Cat2', sortOrder: 2, isActive: true })
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
          organization: 'T053 Org',
          position: 'T053 Role',
          startDate: new Date('2024-01-01'),
          dutiesNarrative: 'Duties for TEST-053 integration test.',
          totalHours,
          hoursPerWeek,
          numberOfWeeks: 5,
          verificationStatus: verified ? 'verified' : 'unverified',
          verifiedByUserId: verified ? m1Id : null,
          verifiedAt: verified ? new Date() : null,
        })
        .returning();
      insertedExpIds.push(row.id);
    }

    // appA (broad): cat1 → 2 verified (100 + 50 = 150 hrs total); cat2 → 1 verified (80 hrs).
    // All 3 experiences verified; 2 categories populated.
    await seedExp(appAId, cat1Id, 100, true);
    await seedExp(appAId, cat1Id, 50, true);
    await seedExp(appAId, cat2Id, 80, true);

    // appB (narrow): cat1 → 1 verified (60 hrs) + 1 unverified (40 hrs).
    // 1 of 2 experiences verified; 1 category populated.
    await seedExp(appBId, cat1Id, 60, true);
    await seedExp(appBId, cat1Id, 40, false);

    // Grants
    await db.insert(mentorGrants).values([
      {
        id: grantIds[0],
        applicantUserId: appAId,
        mentorUserId: m1Id,
        grantedByUserId: m1Id,
        status: 'active',
        permissions: ['read', 'write'],
      },
      {
        id: grantIds[1],
        applicantUserId: appBId,
        mentorUserId: m1Id,
        grantedByUserId: m1Id,
        status: 'active',
        permissions: ['read', 'write'],
      },
      {
        id: grantIds[2],
        applicantUserId: appAId,
        mentorUserId: m2Id,
        grantedByUserId: m2Id,
        status: 'active',
        permissions: ['read', 'write'],
      },
    ]);
    // noGrantMentor receives no grants — intentionally omitted.
  });

  afterAll(async () => {
    await db
      .delete(interviewShortlist)
      .where(inArray(interviewShortlist.reviewerUserId, [m1Id, m2Id, noGrantId]));
    await db.delete(mentorGrants).where(inArray(mentorGrants.id, grantIds));
    await db.delete(experiences).where(inArray(experiences.id, insertedExpIds));
    await db
      .delete(experienceCategories)
      .where(inArray(experienceCategories.id, [cat1Id, cat2Id]));
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Shortlist isolation — end-to-end via talent-pool GET
  // ---------------------------------------------------------------------------

  describe('shortlist isolation (two mentors → same applicant → independent rows)', () => {
    it('M1 and M2 each write their own shortlist row for appA', async () => {
      // M1 shortlists appA with starRating=5
      const r1 = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${appAId}/review`,
        headers: { cookie: m1Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 5 }),
      });
      expect(r1.statusCode).toBe(200);

      // M2 does NOT shortlist appA and gives starRating=1
      const r2 = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${appAId}/review`,
        headers: { cookie: m2Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: false, starRating: 1 }),
      });
      expect(r2.statusCode).toBe(200);

      // Verify two distinct rows exist in the DB (neither write overwrote the other)
      const rows = await db
        .select()
        .from(interviewShortlist)
        .where(eq(interviewShortlist.applicantUserId, appAId));
      const m1Row = rows.find((r) => r.reviewerUserId === m1Id);
      const m2Row = rows.find((r) => r.reviewerUserId === m2Id);
      expect(m1Row).toBeDefined();
      expect(m2Row).toBeDefined();
      expect(m1Row!.starRating).toBe(5);
      expect(m2Row!.starRating).toBe(1);
    });

    it("M1's talent-pool entry for appA reflects M1's own shortlist row (starRating=5)", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const pool = res.json() as Array<{
        applicantUserId: string;
        shortlisted: boolean;
        starRating: number | null;
      }>;
      const entryA = pool.find((e) => e.applicantUserId === appAId);
      expect(entryA).toBeDefined();
      expect(entryA!.shortlisted).toBe(true);
      expect(entryA!.starRating).toBe(5);
    });

    it("M2's talent-pool entry for appA reflects M2's own shortlist row (starRating=1)", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m2Cookie },
      });
      expect(res.statusCode).toBe(200);
      const pool = res.json() as Array<{
        applicantUserId: string;
        shortlisted: boolean;
        starRating: number | null;
      }>;
      const entryA = pool.find((e) => e.applicantUserId === appAId);
      expect(entryA).toBeDefined();
      expect(entryA!.shortlisted).toBe(false);
      expect(entryA!.starRating).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Talent-pool ranking components
  // ---------------------------------------------------------------------------

  describe('talent-pool ranking components (sufficient for deterministic client ranking)', () => {
    type TalentEntry = {
      applicantUserId: string;
      categories: {
        categoryId: string;
        totalHours: number;
        experienceCount: number;
        verifiedCount: number;
      }[];
      experienceCount: number;
      verifiedCount: number;
      activeCategoryCount: number;
    };

    it('returns per-category components for the broad applicant (appA)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const pool = res.json() as TalentEntry[];

      const a = pool.find((e) => e.applicantUserId === appAId);
      expect(a).toBeDefined();

      // activeCategoryCount = total active categories in the system (at least 2 from our seed)
      expect(a!.activeCategoryCount).toBeGreaterThanOrEqual(2);

      const a1 = a!.categories.find((c) => c.categoryId === cat1Id);
      const a2 = a!.categories.find((c) => c.categoryId === cat2Id);
      expect(a1).toBeDefined();
      expect(a2).toBeDefined();

      // cat1: 100 + 50 = 150 hrs, 2 experiences, 2 verified
      expect(a1!.totalHours).toBe(150);
      expect(a1!.experienceCount).toBe(2);
      expect(a1!.verifiedCount).toBe(2);

      // cat2: 80 hrs, 1 experience, 1 verified
      expect(a2!.totalHours).toBe(80);
      expect(a2!.experienceCount).toBe(1);
      expect(a2!.verifiedCount).toBe(1);

      // Summed totals
      expect(a!.experienceCount).toBe(3);
      expect(a!.verifiedCount).toBe(3);
    });

    it('returns per-category components for the narrow applicant (appB)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const pool = res.json() as TalentEntry[];

      const b = pool.find((e) => e.applicantUserId === appBId);
      expect(b).toBeDefined();

      const b1 = b!.categories.find((c) => c.categoryId === cat1Id);
      const b2 = b!.categories.find((c) => c.categoryId === cat2Id);
      expect(b1).toBeDefined();
      expect(b2).toBeDefined();

      // cat1: 60 + 40 = 100 hrs, 2 experiences, 1 verified
      expect(b1!.totalHours).toBe(100);
      expect(b1!.experienceCount).toBe(2);
      expect(b1!.verifiedCount).toBe(1);

      // cat2: zero-filled (no experiences for appB in cat2)
      expect(b2!.totalHours).toBe(0);
      expect(b2!.experienceCount).toBe(0);
      expect(b2!.verifiedCount).toBe(0);

      // Summed totals
      expect(b!.experienceCount).toBe(2);
      expect(b!.verifiedCount).toBe(1);
    });

    it('components produce a deterministic ranking with broad applicant (appA) ranked first', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const pool = res.json() as TalentEntry[];

      const a = pool.find((e) => e.applicantUserId === appAId)!;
      const b = pool.find((e) => e.applicantUserId === appBId)!;

      // Inline readiness (same formula as readiness.ts; goalProgress=0 for test slugs):
      //   appA: verifiedRatio=3/3=1, breadth=2/activeCategoryCount → 40 (or 40+)
      //   appB: verifiedRatio=1/2=0.5, breadth=1/activeCategoryCount → strictly less
      const readinessA = inlineReadiness(a);
      const readinessB = inlineReadiness(b);

      expect(readinessA).toBeGreaterThan(readinessB);

      // A sort by readiness descending places appA at index 0
      const ranked = [a, b].sort(
        (x, y) => inlineReadiness(y) - inlineReadiness(x),
      );
      expect(ranked[0].applicantUserId).toBe(appAId);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Non-grant rejection
  // ---------------------------------------------------------------------------

  describe('non-grant rejection', () => {
    it('returns 403 for a mentor without a grant over appA', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${appAId}/review`,
        headers: { cookie: noGrantCookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
      });
      expect(res.statusCode).toBe(403);
    });

    it('creates no interview_shortlist row for the rejected (noGrant, appA) pair', async () => {
      const rows = await db
        .select()
        .from(interviewShortlist)
        .where(
          and(
            eq(interviewShortlist.reviewerUserId, noGrantId),
            eq(interviewShortlist.applicantUserId, appAId),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });
});
