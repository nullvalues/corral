/**
 * Integration tests for API-036: GET /api/mentor-grants/my-requests
 *
 * Verifies (the story's Ensures):
 *   - 401 when called without a session cookie.
 *   - 403 when called as an admin-only user (no `applicant` system role).
 *   - 200 returning only the caller's own grants — a second applicant's grants
 *     are not visible to the first applicant (auth-scoping invariant).
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { systemRoles, mentorGrants } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sign up a new user via Better Auth and return both the session cookie
 * and the user ID from the response body. Avoids a separate DB lookup.
 */
async function signUpAndGetSession(
  app: FastifyInstance,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-036 Test User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);

  const body = res.json() as { user?: { id?: string } };
  const userId = body.user?.id;
  expect(userId).toBeTruthy();

  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');

  return { cookie, userId: userId! };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/mentor-grants/my-requests (API-036)', () => {
  let app: FastifyInstance;

  const ts = Date.now();
  const applicantAEmail = `api036-applicantA+${ts}@example.com`;
  const applicantBEmail = `api036-applicantB+${ts}@example.com`;
  const adminOnlyEmail = `api036-adminonly+${ts}@example.com`;
  const mentorEmail = `api036-mentor+${ts}@example.com`;

  let applicantACookie: string;
  let applicantBCookie: string;
  let adminOnlyCookie: string;

  let applicantAId: string;
  let adminOnlyId: string;
  let mentorId: string;

  const grantId = `api036-grant-${ts}`;

  beforeAll(async () => {
    app = await buildApp();

    // Sign up all users via Better Auth. The hook auto-assigns the 'applicant' role.
    // Extract the user ID from the sign-up response body to avoid a DB lookup.
    const applicantA = await signUpAndGetSession(app, applicantAEmail);
    applicantACookie = applicantA.cookie;
    applicantAId = applicantA.userId;

    const applicantB = await signUpAndGetSession(app, applicantBEmail);
    applicantBCookie = applicantB.cookie;

    const adminOnly = await signUpAndGetSession(app, adminOnlyEmail);
    adminOnlyCookie = adminOnly.cookie;
    adminOnlyId = adminOnly.userId;

    // Mentor only needs a users row for the inner join in listMyApplicantGrants.
    const mentor = await signUpAndGetSession(app, mentorEmail);
    mentorId = mentor.userId;

    // Strip the auto-assigned 'applicant' role from the admin-only user and give
    // them only the 'admin' role, so they are denied by requireRole('applicant').
    await db.delete(systemRoles).where(eq(systemRoles.userId, adminOnlyId));
    await db.insert(systemRoles).values({ userId: adminOnlyId, role: 'admin' });

    // Create a single active grant: mentorUser → applicantA.
    // applicantB intentionally has no grant.
    await db.insert(mentorGrants).values({
      id: grantId,
      applicantUserId: applicantAId,
      mentorUserId: mentorId,
      grantedByUserId: applicantAId,
      status: 'active',
      permissions: ['read'],
    });
  });

  afterAll(async () => {
    await db.delete(mentorGrants).where(eq(mentorGrants.id, grantId));
    await db.delete(systemRoles).where(eq(systemRoles.userId, adminOnlyId));
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/mentor-grants/my-requests' });
    expect(res.statusCode).toBe(401);
  });

  it('admin-only (no applicant role) → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor-grants/my-requests',
      headers: { cookie: adminOnlyCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('applicantA sees only their own grant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor-grants/my-requests',
      headers: { cookie: applicantACookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { applicantUserId: string }[];
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((g) => g.applicantUserId === applicantAId)).toBe(true);
  });

  it('applicantB sees no grants (scoping — they have no grant)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mentor-grants/my-requests',
      headers: { cookie: applicantBCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});
