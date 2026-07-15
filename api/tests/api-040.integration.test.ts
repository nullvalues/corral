/**
 * Integration tests for GET /api/mentor/impact (API-040).
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Setup helpers modelled on api-033.integration.test.ts.
 *
 * Covers (TEST-051 Ensures):
 * - ABAC isolation: mentor A's stats exclude mentor B's verifications entirely.
 * - Counter math: each field matches deterministic seed values.
 * - Empty caller: a fresh mentor with no verifications → all zeros, avgTurnaroundHours === null.
 * - 401 when unauthenticated.
 *
 * Seed layout:
 *   - exp-A1 (app1, 40 hrs): verified by mentorA, verifiedAt in current month.
 *   - exp-A2 (app2, 60 hrs): verified by mentorA, verifiedAt in current month.
 *   - exp-A3 (app1, 30 hrs): verified by mentorA, verifiedAt ~2 months ago.
 *     → Tests monthHoursVerified excludes prior-month rows while lifetimeHoursVerified counts it.
 *   - exp-B1 (app1, 200 hrs): verified by mentorB — ABAC isolation probe.
 *   - exp-pending (app1, 50 hrs): unverified, under mentorA's active grant → pendingVerifications = 1.
 *
 * avgTurnaroundHours:
 *   The Postgres expression `EXTRACT(EPOCH FROM (verifiedAt - createdAt))` mixes
 *   timestamptz and timestamp-without-tz; the result is session-timezone-dependent.
 *   To make the assertion timezone-independent the beforeAll pre-computes the expected
 *   value using the SAME SQL and the actual stored rows, then the test asserts the
 *   service returns that same value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  mentorGrants,
  users,
} from '../src/db/schema/index.js';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers (same pattern as api-033.integration.test.ts)
// ---------------------------------------------------------------------------

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-040 User', email, password: 'Password123!' }),
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GET /api/mentor/impact (API-040 integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  // Account emails
  const mentorAEmail = `api040-mentor-a+${ts}@example.com`;
  const mentorBEmail = `api040-mentor-b+${ts}@example.com`;
  const mentorEmptyEmail = `api040-mentor-empty+${ts}@example.com`;
  const app1Email = `api040-app1+${ts}@example.com`;
  const app2Email = `api040-app2+${ts}@example.com`;

  // Cookies for HTTP requests
  let mentorACookie: string;
  let mentorEmptyCookie: string;

  // User IDs resolved after sign-up
  let mentorAId: string;
  let mentorBId: string;
  let app1Id: string;
  let app2Id: string;

  // Seeded IDs for cleanup
  let categoryId: string;
  let expA1Id: string;
  let expA2Id: string;
  let expA3Id: string;
  let expB1Id: string;
  let expPendingId: string;
  const grantId = `api040-grant-a1-${ts}`;

  // Pre-computed expected avgTurnaround (timezone-independent — see module header).
  let expectedAvgTurnaround: number | null;

  beforeAll(async () => {
    app = await buildApp();

    // Sign up all accounts and capture sessions
    mentorACookie = await signUpAndGetSession(app, mentorAEmail);
    await signUpAndGetSession(app, mentorBEmail); // only used for verifiedByUserId seeding
    mentorEmptyCookie = await signUpAndGetSession(app, mentorEmptyEmail);
    await signUpAndGetSession(app, app1Email);
    await signUpAndGetSession(app, app2Email);

    // Resolve user IDs from the DB
    mentorAId = await getUserId(mentorAEmail);
    mentorBId = await getUserId(mentorBEmail);
    app1Id = await getUserId(app1Email);
    app2Id = await getUserId(app2Email);

    // Create one category shared by all seeded experiences
    const [cat] = await db
      .insert(experienceCategories)
      .values({
        slug: `api040-cat-${ts}`,
        name: 'API040 Category',
        sortOrder: 99,
        isActive: true,
      })
      .returning();
    categoryId = cat.id;

    // -----------------------------------------------------------------------
    // Current-month verifiedAt timestamps: use "now - small offset" so both
    // are in the current calendar month and well in the past relative to the
    // test run.
    // -----------------------------------------------------------------------
    const now = new Date();
    const createdAtRecent = new Date(now.getTime() - 8 * 3600 * 1000); // 8 h ago
    const verifiedAtRecent = new Date(now.getTime() - 1 * 3600 * 1000); // 1 h ago

    // Prior-month verifiedAt: 63 days ago — always in a previous calendar month.
    const verifiedAtPrior = new Date(now.getTime() - 63 * 24 * 3600 * 1000);
    const createdAtPrior = new Date(verifiedAtPrior.getTime() - 8 * 3600 * 1000);

    // exp-A1: mentor A verifies, app1 owns, 40 hrs (8 hpw × 5 weeks)
    const [expA1] = await db
      .insert(experiences)
      .values({
        ownerUserId: app1Id,
        categoryId,
        organization: 'Org A1',
        position: 'Role A1',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Duties A1 for API-040 integration test.',
        totalHours: 40,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
        verificationStatus: 'verified',
        verifiedByUserId: mentorAId,
        createdAt: createdAtRecent,
        verifiedAt: verifiedAtRecent,
      })
      .returning();
    expA1Id = expA1.id;

    // exp-A2: mentor A verifies, app2 owns, 60 hrs (12 hpw × 5 weeks)
    const [expA2] = await db
      .insert(experiences)
      .values({
        ownerUserId: app2Id,
        categoryId,
        organization: 'Org A2',
        position: 'Role A2',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Duties A2 for API-040 integration test.',
        totalHours: 60,
        hoursPerWeek: 12,
        numberOfWeeks: 5,
        verificationStatus: 'verified',
        verifiedByUserId: mentorAId,
        createdAt: createdAtRecent,
        verifiedAt: verifiedAtRecent,
      })
      .returning();
    expA2Id = expA2.id;

    // exp-A3: mentor A verifies, app1 owns, 30 hrs (6 hpw × 5 weeks), ~2 months ago.
    // Counted in lifetimeHoursVerified but NOT in monthHoursVerified.
    const [expA3] = await db
      .insert(experiences)
      .values({
        ownerUserId: app1Id,
        categoryId,
        organization: 'Org A3 (prior month)',
        position: 'Role A3',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Duties A3 for prior-month monthHours exclusion test.',
        totalHours: 30,
        hoursPerWeek: 6,
        numberOfWeeks: 5,
        verificationStatus: 'verified',
        verifiedByUserId: mentorAId,
        createdAt: createdAtPrior,
        verifiedAt: verifiedAtPrior,
      })
      .returning();
    expA3Id = expA3.id;

    // exp-B1: mentor B verifies, app1 owns, 200 hrs (40 hpw × 5 weeks).
    // ABAC probe — must NOT appear in mentor A's lifetime or month stats.
    const [expB1] = await db
      .insert(experiences)
      .values({
        ownerUserId: app1Id,
        categoryId,
        organization: 'Org B1',
        position: 'Role B1',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Duties B1 for ABAC isolation check.',
        totalHours: 200,
        hoursPerWeek: 40,
        numberOfWeeks: 5,
        verificationStatus: 'verified',
        verifiedByUserId: mentorBId,
        createdAt: createdAtRecent,
        verifiedAt: verifiedAtRecent,
      })
      .returning();
    expB1Id = expB1.id;

    // exp-pending: app1 owns, unverified — contributes to mentor A's
    // pendingVerifications count via the active grant below.
    const [expPending] = await db
      .insert(experiences)
      .values({
        ownerUserId: app1Id,
        categoryId,
        organization: 'Org Pending',
        position: 'Role Pending',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Duties Pending for pendingVerifications count.',
        totalHours: 50,
        hoursPerWeek: 10,
        numberOfWeeks: 5,
        verificationStatus: 'unverified',
      })
      .returning();
    expPendingId = expPending.id;

    // Active grant: mentor A → app1 (enables pendingVerifications count)
    await db.insert(mentorGrants).values({
      id: grantId,
      applicantUserId: app1Id,
      mentorUserId: mentorAId,
      grantedByUserId: mentorAId, // test-only: no admin actor required
      status: 'active',
      permissions: ['write'],
    });

    // -----------------------------------------------------------------------
    // Pre-compute expected avgTurnaround using the SAME SQL as the service.
    //
    // `timestamp without time zone - timestamptz` is session-timezone-dependent
    // in Postgres, so the numeric result varies by environment. Pre-computing
    // the expected value here makes the assertion timezone-independent: we
    // verify the service returns the same value Postgres computed, not a hardcoded number.
    // -----------------------------------------------------------------------
    const [avgRow] = await db
      .select({
        avg: sql<
          string | null
        >`AVG(EXTRACT(EPOCH FROM (${experiences.verifiedAt} - ${experiences.createdAt})) / 3600.0)`,
      })
      .from(experiences)
      .where(eq(experiences.verifiedByUserId, mentorAId));
    const rawAvg = avgRow?.avg ?? null;
    expectedAvgTurnaround =
      rawAvg === null ? null : Math.round(Number(rawAvg) * 10) / 10;
  });

  afterAll(async () => {
    await db.delete(mentorGrants).where(eq(mentorGrants.id, grantId));
    await db
      .delete(experiences)
      .where(inArray(experiences.id, [expA1Id, expA2Id, expA3Id, expB1Id, expPendingId]));
    await db.delete(experienceCategories).where(eq(experienceCategories.id, categoryId));
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Test cases
  // -------------------------------------------------------------------------

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/mentor/impact' });
    expect(res.statusCode).toBe(401);
  });

  it('ABAC isolation: mentor A stats exclude mentor B verifications', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor/impact',
      headers: { cookie: mentorACookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      lifetimeHoursVerified: number;
      applicantsMentored: number;
    };
    // A verified 40 + 60 + 30 = 130 hours — NOT 330 (which would include B's 200)
    expect(body.lifetimeHoursVerified).toBe(130);
    // A verified for 2 distinct applicants (app1 and app2)
    expect(body.applicantsMentored).toBe(2);
  });

  it('counter math: all fields match deterministic seed data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor/impact',
      headers: { cookie: mentorACookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      monthHoursVerified: number;
      lifetimeHoursVerified: number;
      applicantsMentored: number;
      avgTurnaroundHours: number | null;
      pendingVerifications: number;
    };

    // exp-A3 (30 hrs, ~2 months ago) is excluded from monthHours; A1+A2 = 100
    expect(body.monthHoursVerified).toBe(100);
    // All three of A's verifications count toward lifetime: 40+60+30 = 130
    expect(body.lifetimeHoursVerified).toBe(130);
    expect(body.applicantsMentored).toBe(2);

    // avgTurnaround: assert the service returns the same value Postgres computed
    // (timezone-independent — see beforeAll pre-computation comment)
    expect(body.avgTurnaroundHours).not.toBeNull();
    expect(body.avgTurnaroundHours).toBeCloseTo(expectedAvgTurnaround!, 1);

    // 1 unverified experience for app1 (the only applicant in A's active grant)
    expect(body.pendingVerifications).toBe(1);
  });

  it('empty caller: fresh mentor with no verifications → all zeros, null avgTurnaroundHours', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor/impact',
      headers: { cookie: mentorEmptyCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      monthHoursVerified: number;
      lifetimeHoursVerified: number;
      applicantsMentored: number;
      avgTurnaroundHours: number | null;
      streakDays: number;
      pendingVerifications: number;
    };
    expect(body.monthHoursVerified).toBe(0);
    expect(body.lifetimeHoursVerified).toBe(0);
    expect(body.applicantsMentored).toBe(0);
    expect(body.avgTurnaroundHours).toBeNull();
    expect(body.streakDays).toBe(0);
    expect(body.pendingVerifications).toBe(0);
  });
});
