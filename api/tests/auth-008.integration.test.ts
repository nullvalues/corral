/**
 * AUTH-008: ABAC access matrix for GET /api/mentor/talent-pool (API-043)
 * and PATCH /api/mentor/applicants/:id/review (API-044).
 *
 * This is a TEST-ONLY story: it adds no production code. Its sole purpose is
 * to pin the ABAC access grid for these two endpoints as a single, auditable
 * per-cell matrix (distinct from TEST-053, which is the broader functional
 * integration).
 *
 * Actors provisioned:
 *   M1      — mentor 1; active grant to A1 and U-admin (permissions ['read','write']).
 *   M2      — mentor 2; active grant to A2 only; no grant to A1.
 *   A1      — applicant granted to M1.
 *   A2      — applicant granted to M2.
 *   U-admin — holds the admin system role AND an active grant from M1.
 *             Proves pool exclusion is by role, not by grant absence.
 *
 * Shortlist seed for the read-isolation cell:
 *   (M1, A1) starRating=5, shortlisted=true  — M1's private row.
 *   (M2, A1) starRating=2, shortlisted=false — M2's private row (inserted
 *             directly; M2 holds no active grant to A1, so A1 never appears
 *             in M2's pool). M1's pool entry for A1 must reflect only M1's row.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Harness modelled on api-033.integration.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  mentorGrants,
  systemRoles,
  interviewShortlist,
  users,
} from '../src/db/schema/index.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'AUTH-008 User', email, password: 'Password123!' }),
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
  shortlisted: boolean;
  starRating: number | null;
}

describe('AUTH-008 — ABAC access matrix', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const m1Email = `auth008-m1+${ts}@example.com`;
  const m2Email = `auth008-m2+${ts}@example.com`;
  const a1Email = `auth008-a1+${ts}@example.com`;
  const a2Email = `auth008-a2+${ts}@example.com`;
  const adminEmail = `auth008-admin+${ts}@example.com`;

  let m1Cookie: string;
  let m2Cookie: string;

  let m1Id: string;
  let m2Id: string;
  let a1Id: string;
  let a2Id: string;
  let adminId: string;

  const grantM1A1Id = `auth008-grant-m1a1-${ts}`;
  const grantM2A2Id = `auth008-grant-m2a2-${ts}`;
  const grantM1AdminId = `auth008-grant-m1admin-${ts}`;

  beforeAll(async () => {
    app = await buildApp();

    m1Cookie = await signUpAndGetSession(app, m1Email);
    m2Cookie = await signUpAndGetSession(app, m2Email);
    await signUpAndGetSession(app, a1Email);
    await signUpAndGetSession(app, a2Email);
    await signUpAndGetSession(app, adminEmail);

    m1Id = await getUserId(m1Email);
    m2Id = await getUserId(m2Email);
    a1Id = await getUserId(a1Email);
    a2Id = await getUserId(a2Email);
    adminId = await getUserId(adminEmail);

    // Assign the admin role to U-admin.
    await db.insert(systemRoles).values({ userId: adminId, role: 'admin' }).onConflictDoNothing();

    // Insert active grants.
    await db.insert(mentorGrants).values([
      {
        id: grantM1A1Id,
        applicantUserId: a1Id,
        mentorUserId: m1Id,
        grantedByUserId: m1Id,
        status: 'active',
        permissions: ['read', 'write'],
      },
      {
        id: grantM2A2Id,
        applicantUserId: a2Id,
        mentorUserId: m2Id,
        grantedByUserId: m2Id,
        status: 'active',
        permissions: ['read', 'write'],
      },
      // M1 holds an active grant for U-admin — exclusion must be by admin role,
      // not by absence of a grant.
      {
        id: grantM1AdminId,
        applicantUserId: adminId,
        mentorUserId: m1Id,
        grantedByUserId: m1Id,
        status: 'active',
        permissions: ['read'],
      },
    ]);

    // Seed shortlist rows directly for the read-isolation cell.
    // M2 has no active grant to A1, so this row is never surfaced via the API
    // to M2; it exists only to prove M1's pool entry for A1 is isolated to M1's
    // own row and does not bleed M2's data.
    await db.insert(interviewShortlist).values([
      {
        reviewerUserId: m1Id,
        applicantUserId: a1Id,
        shortlisted: true,
        starRating: 5,
      },
      {
        reviewerUserId: m2Id,
        applicantUserId: a1Id,
        shortlisted: false,
        starRating: 2,
      },
    ]);
  });

  afterAll(async () => {
    // Remove all shortlist rows owned by M1 or M2 (covers seeded rows + any
    // rows written by the PATCH tests).
    await db
      .delete(interviewShortlist)
      .where(inArray(interviewShortlist.reviewerUserId, [m1Id, m2Id]));
    await db
      .delete(mentorGrants)
      .where(inArray(mentorGrants.id, [grantM1A1Id, grantM2A2Id, grantM1AdminId]));
    await db.delete(systemRoles).where(eq(systemRoles.userId, adminId));
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/mentor/talent-pool
  // ---------------------------------------------------------------------------
  describe('GET /api/mentor/talent-pool', () => {
    it('unauthenticated → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/mentor/talent-pool' });
      expect(res.statusCode).toBe(401);
    });

    it('M1 → 200; pool contains A1 and excludes A2', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as TalentEntry[]).map((e) => e.applicantUserId);
      expect(ids).toContain(a1Id);
      expect(ids).not.toContain(a2Id);
    });

    it('M2 → 200; pool contains A2 and excludes A1 (no cross-mentor leak)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m2Cookie },
      });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as TalentEntry[]).map((e) => e.applicantUserId);
      expect(ids).toContain(a2Id);
      expect(ids).not.toContain(a1Id);
    });

    it("M1 → A1 entry shortlisted/starRating reflect only M1's own review row (read-isolation)", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as TalentEntry[];
      const a1Entry = body.find((e) => e.applicantUserId === a1Id);
      expect(a1Entry).toBeDefined();
      // M1's seeded row: shortlisted=true, starRating=5.
      // M2's seeded row for the same applicant (starRating=2) must not bleed through.
      expect(a1Entry!.shortlisted).toBe(true);
      expect(a1Entry!.starRating).toBe(5);
    });

    it("U-admin (with active grant from M1) is excluded from M1's pool by admin role", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/talent-pool',
        headers: { cookie: m1Cookie },
      });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as TalentEntry[]).map((e) => e.applicantUserId);
      // U-admin has an active grant from M1 yet must not appear — excluded by role.
      expect(ids).not.toContain(adminId);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/mentor/applicants/:id/review
  // ---------------------------------------------------------------------------
  describe('PATCH /api/mentor/applicants/:id/review', () => {
    it('unauthenticated → 401', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${a1Id}/review`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('M1 PATCH review A1 (granted) → 200; row written for (M1, A1)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${a1Id}/review`,
        headers: { cookie: m1Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reviewerUserId).toBe(m1Id);
      expect(body.applicantUserId).toBe(a1Id);

      // Confirm the row exists in the DB for the (M1, A1) composite PK.
      const rows = await db
        .select()
        .from(interviewShortlist)
        .where(
          and(
            eq(interviewShortlist.reviewerUserId, m1Id),
            eq(interviewShortlist.applicantUserId, a1Id),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it('M1 PATCH review A2 (not granted) → 403', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${a2Id}/review`,
        headers: { cookie: m1Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
      });
      expect(res.statusCode).toBe(403);
    });

    it('M1 PATCH review random non-existent id → 403 (identical to no-grant — no existence leak)', async () => {
      const nonExistentId = `nonexistent-user-auth008-${ts}`;
      const resNonExistent = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${nonExistentId}/review`,
        headers: { cookie: m1Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
      });
      expect(resNonExistent.statusCode).toBe(403);

      // The response body must be indistinguishable from the no-grant case.
      const resNoGrant = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${a2Id}/review`,
        headers: { cookie: m1Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
      });
      expect(resNonExistent.json()).toEqual(resNoGrant.json());
    });

    it("M2 PATCH review A1 (no grant) → 403 and does NOT mutate M1's (M1, A1) row", async () => {
      // Capture M1's current (M1, A1) row before M2's attempt.
      const before = await db
        .select()
        .from(interviewShortlist)
        .where(
          and(
            eq(interviewShortlist.reviewerUserId, m1Id),
            eq(interviewShortlist.applicantUserId, a1Id),
          ),
        );
      expect(before).toHaveLength(1);

      // M2 attempts to overwrite A1's review — must be denied.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/mentor/applicants/${a1Id}/review`,
        headers: { cookie: m2Cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ shortlisted: false, starRating: 1 }),
      });
      expect(res.statusCode).toBe(403);

      // M1's row must be completely unchanged.
      const after = await db
        .select()
        .from(interviewShortlist)
        .where(
          and(
            eq(interviewShortlist.reviewerUserId, m1Id),
            eq(interviewShortlist.applicantUserId, a1Id),
          ),
        );
      expect(after).toHaveLength(1);
      expect(after[0].shortlisted).toBe(before[0].shortlisted);
      expect(after[0].starRating).toBe(before[0].starRating);
    });
  });
});
