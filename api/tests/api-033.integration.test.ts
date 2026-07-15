/**
 * Integration tests for API-033: PATCH /api/experiences/:id/verification
 *
 * Mentor verify / un-verify of an applicant's experience.
 *
 * API-037 update: denyRole('applicant') was removed — a caller holding the
 * 'applicant' role AND an active write grant may now verify. The mentor in
 * this test retains its auto-assigned 'applicant' role (no role-stripping).
 *
 * Verifies (the story's Ensures):
 *   - Mentor with 'applicant' role AND active write grant → 200 (no role-stripping).
 *   - Admin → 403 (denyRole('admin') RBAC deny).
 *   - Mentor without a grant → 403 for both an existing id and a random
 *     non-existent UUID (identical 403 — no existence leak, CER-035).
 *   - Applicant attempting to verify their own experience → 403 (self-verify guard).
 *   - Unauthenticated → 401.
 *   - Un-verify clears verifiedByUserId / verifiedAt and resets status.
 *   - Un-verify on already-unverified → 200, idempotent.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  mentorGrants,
  systemRoles,
  piiAccessLog,
  users,
} from '../src/db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-033 User', email, password: 'Password123!' }),
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

describe('PATCH /api/experiences/:id/verification (API-033)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const ownerEmail = `api033-owner+${ts}@example.com`;
  // Mentor retains its auto-assigned 'applicant' role — no stripping (API-037).
  const mentorEmail = `api033-mentor+${ts}@example.com`;
  const noGrantMentorEmail = `api033-nogrant+${ts}@example.com`;
  const adminEmail = `api033-admin+${ts}@example.com`;

  let ownerCookie: string;
  let mentorCookie: string;
  let noGrantMentorCookie: string;
  let adminCookie: string;

  let ownerId: string;
  let mentorId: string;
  let adminId: string;

  let categoryId: string;
  let experienceId: string;
  const grantId = `api033-grant-${ts}`;

  beforeAll(async () => {
    app = await buildApp();

    ownerCookie = await signUpAndGetSession(app, ownerEmail);
    mentorCookie = await signUpAndGetSession(app, mentorEmail);
    noGrantMentorCookie = await signUpAndGetSession(app, noGrantMentorEmail);
    adminCookie = await signUpAndGetSession(app, adminEmail);

    ownerId = await getUserId(ownerEmail);
    mentorId = await getUserId(mentorEmail);
    adminId = await getUserId(adminEmail);

    // Mentor keeps the 'applicant' role — API-037 removed denyRole('applicant').
    // Elevate the admin user.
    await db.insert(systemRoles).values({ userId: adminId, role: 'admin' }).onConflictDoNothing();

    const [category] = await db
      .insert(experienceCategories)
      .values({ slug: `api033-cat-${ts}`, name: 'API033 Category', sortOrder: 99, isActive: true })
      .returning();
    categoryId = category.id;

    const [exp] = await db
      .insert(experiences)
      .values({
        ownerUserId: ownerId,
        categoryId,
        organization: 'Verifiable Org',
        position: 'Researcher',
        startDate: new Date('2023-01-01'),
        dutiesNarrative: 'Did verifiable work.',
        totalHours: 40,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
      })
      .returning();
    experienceId = exp.id;
    expect(exp.verificationStatus).toBe('unverified');

    // Mentor grant with 'write' permission over the owner.
    await db.insert(mentorGrants).values({
      id: grantId,
      applicantUserId: ownerId,
      mentorUserId: mentorId,
      grantedByUserId: ownerId,
      status: 'active',
      permissions: ['write'],
    });
  });

  afterAll(async () => {
    await db.delete(mentorGrants).where(eq(mentorGrants.id, grantId));
    await db.delete(piiAccessLog).where(eq(piiAccessLog.subjectUserId, ownerId));
    await db.delete(experiences).where(eq(experiences.id, experienceId));
    await db.delete(experienceCategories).where(eq(experienceCategories.id, categoryId));
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('admin → 403 (denyRole admin)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('applicant attempting to verify their own experience → 403 (self-verify guard)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('mentor without a grant → 403 for an existing experience (no existence leak)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: noGrantMentorCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('mentor without a grant → 403 for a non-existent UUID (identical to existing, no leak — CER-035)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/00000000-0000-0000-0000-000000000000/verification`,
      headers: { 'content-type': 'application/json', cookie: noGrantMentorCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('mentor with active write grant and applicant role: verify → 200, fields set, pii_access_log row written', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verificationStatus: string;
      verifiedByUserId: string | null;
      verifiedAt: string | null;
    };
    expect(body.verificationStatus).toBe('verified');
    expect(body.verifiedByUserId).toBe(mentorId);
    expect(body.verifiedAt).not.toBeNull();

    // insertPiiAccessLog is fire-and-forget (unawaited); wait for the row to land.
    await new Promise((r) => setTimeout(r, 100));

    // A pii_access_log row was written (action 'update', via grant).
    const logs = await db
      .select()
      .from(piiAccessLog)
      .where(
        and(
          eq(piiAccessLog.actorUserId, mentorId),
          eq(piiAccessLog.subjectUserId, ownerId),
          eq(piiAccessLog.resourceId, experienceId),
        ),
      );
    const updateLog = logs.find((l) => l.action === 'update');
    expect(updateLog).toBeDefined();
    expect(updateLog?.viaGrant).toBe(true);
  });

  it('un-verify → 200, clears verifiedByUserId and verifiedAt', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'unverify' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verificationStatus: string;
      verifiedByUserId: string | null;
      verifiedAt: string | null;
    };
    expect(body.verificationStatus).toBe('unverified');
    expect(body.verifiedByUserId).toBeNull();
    expect(body.verifiedAt).toBeNull();
  });

  it('un-verify writes pii_access_log row', async () => {
    // Ensure the experience is in 'verified' state first.
    await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });

    // Now un-verify.
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'unverify' }),
    });
    expect(res.statusCode).toBe(200);

    // insertPiiAccessLog is fire-and-forget. Poll until the row lands rather
    // than using a fixed setTimeout: a deterministic poll guarantees the async
    // insert has fully settled (connection released to the shared pool) before
    // this test returns, so no in-flight operation can leak past the suite's
    // teardown and pollute other integration test files.
    const pollForViaGrantLog = async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const rows = await db
          .select()
          .from(piiAccessLog)
          .where(
            and(
              eq(piiAccessLog.actorUserId, mentorId),
              eq(piiAccessLog.subjectUserId, ownerId),
              eq(piiAccessLog.resourceId, experienceId),
            ),
          );
        const found = rows.find((l) => l.viaGrant === true);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      return undefined;
    };

    const unverifyLog = await pollForViaGrantLog();
    expect(unverifyLog).toBeDefined();
  });

  it('un-verify on already-unverified → 200, no-op (idempotent)', async () => {
    // The previous test left the experience in the 'unverified' state.
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'unverify' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verificationStatus: string;
      verifiedByUserId: string | null;
      verifiedAt: string | null;
    };
    expect(body.verificationStatus).toBe('unverified');
    expect(body.verifiedByUserId).toBeNull();
    expect(body.verifiedAt).toBeNull();
  });
});
