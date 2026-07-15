/**
 * Integration tests for API-031 / API-050: POST /api/mentor-grants/requests
 *
 * Verifies anti-enumeration contract (API-050): the endpoint returns
 * 201 { message: 'Request sent' } unconditionally so callers cannot use
 * HTTP status codes to determine whether an email is registered or a grant
 * already exists.
 *
 *   - Applicant creates a request → 201 { message: 'Request sent' }, grant created
 *   - Duplicate request → 201 { message: 'Request sent' } (was 409)
 *   - Unknown mentor email → 201 { message: 'Request sent' } (was 404)
 *   - Admin caller → 403
 *   - Unauthenticated → 401
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles, mentorGrants } from '../src/db/schema/index.js';
import { and, eq } from 'drizzle-orm';
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
    payload: JSON.stringify({ name: 'API-031 Test User', email, password: 'Password123!' }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/mentor-grants/requests', () => {
  let app: FastifyInstance;

  let applicantCookie: string;
  let applicantId: string;

  let adminCookie: string;
  let adminId: string;

  let mentorEmail: string;

  const ts = Date.now();
  const applicantEmail = `api031-applicant+${ts}@example.com`;
  const adminEmail = `api031-admin+${ts}@example.com`;

  beforeAll(async () => {
    app = await buildApp();

    mentorEmail = `api031-mentor+${ts}@example.com`;

    applicantCookie = await signUpAndGetSession(app, applicantEmail);
    adminCookie = await signUpAndGetSession(app, adminEmail);
    // Mentor just needs a user account so they can be looked up by email
    await signUpAndGetSession(app, mentorEmail);

    applicantId = await getUserId(applicantEmail);
    adminId = await getUserId(adminEmail);

    // Elevate the admin user
    await assignRoleDb(adminId, 'admin');
  });

  afterAll(async () => {
    // Clean up grants created during tests
    await db
      .delete(mentorGrants)
      .where(eq(mentorGrants.applicantUserId, applicantId));
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Happy path: applicant creates a pending grant request
  // ---------------------------------------------------------------------------

  it('applicant creates a request → 201 { message: "Request sent" }, grant row created in DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mentor-grants/requests',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ mentorEmail }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { message: string };
    expect(body.message).toBe('Request sent');

    // Verify the grant row was actually created in the DB
    const mentorId = await getUserId(mentorEmail);
    const rows = await db
      .select()
      .from(mentorGrants)
      .where(and(eq(mentorGrants.applicantUserId, applicantId), eq(mentorGrants.mentorUserId, mentorId)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].requestedByUserId).toBe(applicantId);
  });

  it('duplicate request → 201 { message: "Request sent" } (anti-enumeration, was 409)', async () => {
    // A pending grant already exists from the previous test
    const res = await app.inject({
      method: 'POST',
      url: '/api/mentor-grants/requests',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ mentorEmail }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { message: string };
    expect(body.message).toBe('Request sent');
  });

  // ---------------------------------------------------------------------------
  // Guard: unknown mentor email → 201 (anti-enumeration, was 404)
  // ---------------------------------------------------------------------------

  it('unknown mentor email → 201 { message: "Request sent" } (anti-enumeration, was 404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mentor-grants/requests',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ mentorEmail: 'nobody-exists@nowhere.example.com' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { message: string };
    expect(body.message).toBe('Request sent');
  });

  // ---------------------------------------------------------------------------
  // Guard: admin caller → 403 (denyRole('admin'))
  // ---------------------------------------------------------------------------

  it('admin caller → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mentor-grants/requests',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ mentorEmail }),
    });

    expect(res.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Guard: unauthenticated → 401
  // ---------------------------------------------------------------------------

  it('unauthenticated → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mentor-grants/requests',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ mentorEmail }),
    });

    expect(res.statusCode).toBe(401);
  });
});
