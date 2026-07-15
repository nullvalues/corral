/**
 * Integration tests for API-032: Admin grant review queue.
 *
 * Verifies:
 *   GET /api/mentor-grants?status=pending
 *   - admin sees pending grants with applicantName/Email/mentorName/Email
 *   - non-admin caller receives 403
 *
 *   PATCH /api/mentor-grants/:id with { status: 'active' }
 *   - approve: 200, grant is active, admin_action_log row written with action='grant_review'
 *
 *   PATCH /api/mentor-grants/:id with { status: 'revoked' }
 *   - reject: 200, grant is revoked, admin_action_log row written with action='grant_review'
 *
 *   Non-admin caller → 403
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles, mentorGrants } from '../src/db/schema/index.js';
import { adminActionLog } from '../src/db/schema/audit.js';
import { and, eq, desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hasMentorGrant } from '../src/services/auth/abacPredicates.js';

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
    payload: JSON.stringify({ name: 'API-032 Test User', email, password: 'Password123!' }),
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

async function assignRoleDb(userId: string, role: 'admin' | 'applicant'): Promise<void> {
  await db.insert(systemRoles).values({ userId, role }).onConflictDoNothing();
}

async function latestGrantReviewLog(grantId: string) {
  const rows = await db
    .select()
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.resourceType, 'mentor_grant'),
        eq(adminActionLog.resourceId, grantId),
        eq(adminActionLog.action, 'grant_review'),
      ),
    )
    .orderBy(desc(adminActionLog.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin grant review queue (API-032)', () => {
  let app: FastifyInstance;

  let adminCookie: string;
  let adminId: string;

  let applicantCookie: string;
  let applicantId: string;

  let mentorId: string;

  // A second applicant used exclusively for the regression grant (avoids conflicting
  // with the active-pair unique index introduced by DB-029 when pendingGrantForApprove
  // is approved for the same mentor/applicant pair).
  let applicant2Id: string;

  // Grant IDs seeded during beforeAll
  let pendingGrantForApprove: string;
  let pendingGrantForReject: string;
  let readWriteGrantForRegression: string;

  const ts = Date.now();
  const adminEmail = `api032-admin+${ts}@example.com`;
  const applicantEmail = `api032-applicant+${ts}@example.com`;
  const applicant2Email = `api032-applicant2+${ts}@example.com`;
  const mentorEmail = `api032-mentor+${ts}@example.com`;

  beforeAll(async () => {
    app = await buildApp();

    adminCookie = await signUpAndGetSession(app, adminEmail);
    applicantCookie = await signUpAndGetSession(app, applicantEmail);
    await signUpAndGetSession(app, applicant2Email);
    await signUpAndGetSession(app, mentorEmail);

    adminId = await getUserId(adminEmail);
    applicantId = await getUserId(applicantEmail);
    applicant2Id = await getUserId(applicant2Email);
    mentorId = await getUserId(mentorEmail);

    await assignRoleDb(adminId, 'admin');

    // Seed two pending grants for the approve and reject tests
    const { randomUUID } = await import('crypto');

    pendingGrantForApprove = randomUUID();
    pendingGrantForReject = randomUUID();
    readWriteGrantForRegression = randomUUID();

    await db.insert(mentorGrants).values([
      {
        id: pendingGrantForApprove,
        applicantUserId: applicantId,
        mentorUserId: mentorId,
        grantedByUserId: applicantId,
        status: 'pending',
        permissions: ['read'],
        requestedByUserId: applicantId,
      },
      {
        id: pendingGrantForReject,
        applicantUserId: applicantId,
        mentorUserId: adminId,  // use admin as 2nd mentor (different user)
        grantedByUserId: applicantId,
        status: 'pending',
        permissions: ['read'],
        requestedByUserId: applicantId,
      },
      {
        // DB-029: use applicant2Id (different pair) so approving pendingGrantForApprove
        // for (mentorId, applicantId) does not conflict with this active grant.
        id: readWriteGrantForRegression,
        applicantUserId: applicant2Id,
        mentorUserId: mentorId,
        grantedByUserId: adminId,
        status: 'active',
        permissions: ['read', 'write'],
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(mentorGrants).where(eq(mentorGrants.applicantUserId, applicantId));
    await db.delete(mentorGrants).where(eq(mentorGrants.applicantUserId, applicant2Id));
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/mentor-grants?status=pending
  // ---------------------------------------------------------------------------

  it('admin: GET ?status=pending returns only pending grants with enriched names', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor-grants?status=pending',
      headers: { cookie: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      status: string;
      applicantName: string;
      applicantEmail: string;
      mentorName: string;
      mentorEmail: string;
    }>;
    expect(Array.isArray(body)).toBe(true);

    // All returned grants must be pending
    expect(body.every((g) => g.status === 'pending')).toBe(true);

    // Our two seeded grants should appear
    const ourGrants = body.filter(
      (g) => g.id === pendingGrantForApprove || g.id === pendingGrantForReject,
    );
    expect(ourGrants.length).toBe(2);

    // Each should have enriched name/email fields
    for (const g of ourGrants) {
      expect(typeof g.applicantName).toBe('string');
      expect(typeof g.applicantEmail).toBe('string');
      expect(typeof g.mentorName).toBe('string');
      expect(typeof g.mentorEmail).toBe('string');
      expect(g.applicantEmail).toBe(applicantEmail);
    }
  });

  it('non-admin: GET ?status=pending → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor-grants?status=pending',
      headers: { cookie: applicantCookie },
    });

    expect(res.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/mentor-grants/:id — approve (pending → active)
  // ---------------------------------------------------------------------------

  it('approve: PATCH with { status: "active" } → 200, grant is active', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor-grants/${pendingGrantForApprove}`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ status: 'active' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe('active');
  });

  it('approve: admin_action_log row written with action="grant_review" and resource_type="mentor_grant"', async () => {
    const row = await latestGrantReviewLog(pendingGrantForApprove);
    expect(row).not.toBeNull();
    expect(row!.actorUserId).toBe(adminId);
    expect(row!.action).toBe('grant_review');
    expect(row!.resourceType).toBe('mentor_grant');
    expect(row!.resourceId).toBe(pendingGrantForApprove);
  });

  it('approve: approved grant has permissions including "read" and hasMentorGrant returns true', async () => {
    // Re-fetch the grant from DB to assert permissions were preserved
    const [grant] = await db
      .select()
      .from(mentorGrants)
      .where(eq(mentorGrants.id, pendingGrantForApprove))
      .limit(1);
    expect(grant).toBeDefined();
    expect(grant.status).toBe('active');
    expect(grant.permissions).toContain('read');

    // hasMentorGrant ABAC predicate must return true for 'read'
    const hasGrant = await hasMentorGrant(mentorId, applicantId, 'read');
    expect(hasGrant).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Regression: status-only PATCH on ['read', 'write'] grant preserves both
  // ---------------------------------------------------------------------------

  it('regression: status-only PATCH on a ["read","write"] active grant leaves both permissions intact', async () => {
    // Patch only the status (no permissions field)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor-grants/${readWriteGrantForRegression}`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ status: 'active' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string; permissions: string[] };
    expect(body.permissions).toContain('read');
    expect(body.permissions).toContain('write');
    expect(body.permissions).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/mentor-grants/:id — reject (pending → revoked)
  // ---------------------------------------------------------------------------

  it('reject: PATCH with { status: "revoked" } → 200, grant is revoked', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor-grants/${pendingGrantForReject}`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ status: 'revoked' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe('revoked');
  });

  it('reject: admin_action_log row written with action="grant_review" and resource_type="mentor_grant"', async () => {
    const row = await latestGrantReviewLog(pendingGrantForReject);
    expect(row).not.toBeNull();
    expect(row!.actorUserId).toBe(adminId);
    expect(row!.action).toBe('grant_review');
    expect(row!.resourceType).toBe('mentor_grant');
    expect(row!.resourceId).toBe(pendingGrantForReject);
  });

  // ---------------------------------------------------------------------------
  // Guard: non-admin PATCH → 403
  // ---------------------------------------------------------------------------

  it('non-admin: PATCH /api/mentor-grants/:id → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor-grants/${pendingGrantForApprove}`,
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ status: 'revoked' }),
    });

    expect(res.statusCode).toBe(403);
  });
});
