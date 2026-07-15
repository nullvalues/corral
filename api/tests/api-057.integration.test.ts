/**
 * Integration tests for API-057 — profile API expansion.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Harness modelled on api-044.integration.test.ts / api-047.integration.test.ts.
 *
 * Covers (API-057 Ensures / Tests):
 * - GET /api/me/profile includes the five new fields; PATCH round-trips them.
 * - GET /api/mentor/applicants/:id/profile returns 200 with the scoped field
 *   set for a mentor holding an active read grant; the body contains no `phone`
 *   or `gpa` keys.
 * - The same request without a grant is rejected with 403.
 * - A successful mentor profile read writes a pii_access_log row with
 *   resourceType 'user_profile', resourceId null, and viaGrant true.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { mentorGrants, userProfiles, piiAccessLog, users } from '../src/db/schema/index.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
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

describe('API-057 profile expansion (integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const applicantEmail = `api057-applicant+${ts}@example.com`;
  const mentorEmail = `api057-mentor+${ts}@example.com`;
  const strangerEmail = `api057-stranger+${ts}@example.com`;

  let applicantCookie: string;
  let mentorCookie: string;
  let strangerCookie: string;

  let applicantId: string;
  let mentorId: string;

  const grantId = `api057-grant-${ts}`;

  beforeAll(async () => {
    app = await buildApp();

    applicantCookie = await signUpAndGetSession(app, applicantEmail, 'Applicant Ann');
    mentorCookie = await signUpAndGetSession(app, mentorEmail, 'Mentor Mo');
    strangerCookie = await signUpAndGetSession(app, strangerEmail, 'Stranger Sam');

    applicantId = await getUserId(applicantEmail);
    mentorId = await getUserId(mentorEmail);

    // Mentor holds an active 'read' grant over the applicant. Stranger holds none.
    await db.insert(mentorGrants).values({
      id: grantId,
      applicantUserId: applicantId,
      mentorUserId: mentorId,
      grantedByUserId: mentorId,
      status: 'active',
      permissions: ['read'],
    });
  });

  afterAll(async () => {
    await db.delete(piiAccessLog).where(eq(piiAccessLog.subjectUserId, applicantId));
    await db.delete(mentorGrants).where(inArray(mentorGrants.id, [grantId]));
    await db.delete(userProfiles).where(eq(userProfiles.userId, applicantId));
    await app.close();
  });

  it('GET /me/profile includes the five new fields (null by default)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/profile',
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('major', null);
    expect(body).toHaveProperty('gpa', null);
    expect(body).toHaveProperty('phone', null);
    expect(body).toHaveProperty('linkedinUrl', null);
    expect(body).toHaveProperty('portfolioUrl', null);
  });

  it('PATCH /me/profile round-trips the five new fields', async () => {
    const payload = {
      major: 'Biology',
      gpa: '3.85',
      phone: '+14155550123',
      linkedinUrl: 'https://linkedin.com/in/ann',
      portfolioUrl: 'https://ann.example.com',
    };
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify(payload),
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = patchRes.json();
    expect(patchBody.major).toBe('Biology');
    expect(patchBody.gpa).toBe('3.85');
    expect(patchBody.phone).toBe('+14155550123');
    expect(patchBody.linkedinUrl).toBe('https://linkedin.com/in/ann');
    expect(patchBody.portfolioUrl).toBe('https://ann.example.com');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/me/profile',
      headers: { cookie: applicantCookie },
    });
    const getBody = getRes.json();
    expect(getBody.major).toBe('Biology');
    expect(getBody.gpa).toBe('3.85');
    expect(getBody.phone).toBe('+14155550123');
    expect(getBody.linkedinUrl).toBe('https://linkedin.com/in/ann');
    expect(getBody.portfolioUrl).toBe('https://ann.example.com');
  });

  it('PATCH /me/profile rejects a non-E.164 phone with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ phone: '415-555-0123' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /mentor/applicants/:id/profile — 200 with scoped fields for a granted mentor; no phone/gpa', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/mentor/applicants/${applicantId}/profile`,
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Applicant Ann');
    expect(body.major).toBe('Biology');
    expect(body.linkedinUrl).toBe('https://linkedin.com/in/ann');
    expect(body.portfolioUrl).toBe('https://ann.example.com');
    // Scoped exclusions — the keys must not be present at all.
    expect(Object.prototype.hasOwnProperty.call(body, 'phone')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'gpa')).toBe(false);
  });

  it('GET /mentor/applicants/:id/profile — 403 without a grant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/mentor/applicants/${applicantId}/profile`,
      headers: { cookie: strangerCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /mentor/applicants/:id/profile — 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/mentor/applicants/${applicantId}/profile`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('a successful mentor read writes a pii_access_log row (resourceId null, viaGrant true)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/mentor/applicants/${applicantId}/profile`,
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);

    // insertPiiAccessLog is fire-and-forget; poll briefly for the row.
    let row: typeof piiAccessLog.$inferSelect | undefined;
    for (let i = 0; i < 20; i++) {
      const rows = await db
        .select()
        .from(piiAccessLog)
        .where(
          and(
            eq(piiAccessLog.actorUserId, mentorId),
            eq(piiAccessLog.subjectUserId, applicantId),
            eq(piiAccessLog.resourceType, 'user_profile'),
          ),
        )
        .orderBy(desc(piiAccessLog.createdAt))
        .limit(1);
      if (rows.length) {
        row = rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(row).toBeDefined();
    expect(row!.action).toBe('read');
    expect(row!.resourceType).toBe('user_profile');
    expect(row!.resourceId).toBeNull();
    expect(row!.viaGrant).toBe(true);
  });
});
