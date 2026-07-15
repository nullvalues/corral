/**
 * Integration tests for PATCH /api/mentor/applicants/:id/review (API-044).
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Harness modelled on api-043.integration.test.ts.
 *
 * Covers (API-044 Ensures / Tests):
 * - Mentor with an active 'read' grant over applicant A → PATCH { shortlisted:
 *   true, starRating: 4 } → 200; row persisted for (mentor, A).
 * - A second PATCH by the same mentor for A updates the SAME row (idempotent
 *   upsert — exactly one row for the pair).
 * - No grant → 403; a random non-existent id → 403 (identical, no existence leak).
 * - Two different mentors PATCH the same applicant → two distinct rows;
 *   mentor X's starRating is unaffected by mentor Y's write.
 * - starRating: 6 → 400 (Zod bounds); starRating: null accepted → 200.
 * - Unauthenticated → 401.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { mentorGrants, interviewShortlist, users } from '../src/db/schema/index.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-044 User', email, password: 'Password123!' }),
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

describe('PATCH /api/mentor/applicants/:id/review (API-044 integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const mentorXEmail = `api044-mentor-x+${ts}@example.com`;
  const mentorYEmail = `api044-mentor-y+${ts}@example.com`;
  const appAEmail = `api044-app-a+${ts}@example.com`;
  const appBEmail = `api044-app-b+${ts}@example.com`;

  let mentorXCookie: string;
  let mentorYCookie: string;

  let mentorXId: string;
  let mentorYId: string;
  let appAId: string;
  let appBId: string;

  const grantIds = [`api044-grant-xa-${ts}`, `api044-grant-ya-${ts}`];

  beforeAll(async () => {
    app = await buildApp();

    mentorXCookie = await signUpAndGetSession(app, mentorXEmail);
    mentorYCookie = await signUpAndGetSession(app, mentorYEmail);
    await signUpAndGetSession(app, appAEmail);
    await signUpAndGetSession(app, appBEmail);

    mentorXId = await getUserId(mentorXEmail);
    mentorYId = await getUserId(mentorYEmail);
    appAId = await getUserId(appAEmail);
    appBId = await getUserId(appBEmail);

    // Both mentors hold an active 'read' grant over applicant A.
    // Neither holds any grant over applicant B.
    await db.insert(mentorGrants).values([
      {
        id: grantIds[0],
        applicantUserId: appAId,
        mentorUserId: mentorXId,
        grantedByUserId: mentorXId,
        status: 'active',
        permissions: ['read'],
      },
      {
        id: grantIds[1],
        applicantUserId: appAId,
        mentorUserId: mentorYId,
        grantedByUserId: mentorYId,
        status: 'active',
        permissions: ['read'],
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(interviewShortlist)
      .where(inArray(interviewShortlist.reviewerUserId, [mentorXId, mentorYId]));
    await db.delete(mentorGrants).where(inArray(mentorGrants.id, grantIds));
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appAId}/review`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('upserts a review for a granted applicant and returns 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appAId}/review`,
      headers: { cookie: mentorXCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: 4 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reviewerUserId).toBe(mentorXId);
    expect(body.applicantUserId).toBe(appAId);
    expect(body.shortlisted).toBe(true);
    expect(body.starRating).toBe(4);

    const rows = await db
      .select()
      .from(interviewShortlist)
      .where(
        and(
          eq(interviewShortlist.reviewerUserId, mentorXId),
          eq(interviewShortlist.applicantUserId, appAId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].shortlisted).toBe(true);
    expect(rows[0].starRating).toBe(4);
  });

  it('a second PATCH by the same mentor updates the same row (idempotent upsert)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appAId}/review`,
      headers: { cookie: mentorXCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: false, starRating: 2 }),
    });
    expect(res.statusCode).toBe(200);

    const rows = await db
      .select()
      .from(interviewShortlist)
      .where(
        and(
          eq(interviewShortlist.reviewerUserId, mentorXId),
          eq(interviewShortlist.applicantUserId, appAId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].shortlisted).toBe(false);
    expect(rows[0].starRating).toBe(2);
  });

  it('returns 403 without a grant and for a non-existent id (no existence leak)', async () => {
    // Mentor X has no grant over applicant B.
    const noGrant = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appBId}/review`,
      headers: { cookie: mentorXCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
    });
    expect(noGrant.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/nonexistent-user-id-${ts}/review`,
      headers: { cookie: mentorXCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: 3 }),
    });
    expect(missing.statusCode).toBe(403);
    // Identical bodies — no existence leak.
    expect(missing.json()).toEqual(noGrant.json());
  });

  it('two mentors reviewing the same applicant own distinct rows', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appAId}/review`,
      headers: { cookie: mentorYCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: 5 }),
    });
    expect(res.statusCode).toBe(200);

    const xRows = await db
      .select()
      .from(interviewShortlist)
      .where(
        and(
          eq(interviewShortlist.reviewerUserId, mentorXId),
          eq(interviewShortlist.applicantUserId, appAId),
        ),
      );
    const yRows = await db
      .select()
      .from(interviewShortlist)
      .where(
        and(
          eq(interviewShortlist.reviewerUserId, mentorYId),
          eq(interviewShortlist.applicantUserId, appAId),
        ),
      );
    // Mentor X's row is unaffected by mentor Y's write.
    expect(xRows[0].starRating).toBe(2);
    expect(yRows[0].starRating).toBe(5);
  });

  it('rejects starRating out of bounds with 400 and accepts null with 200', async () => {
    const tooHigh = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appAId}/review`,
      headers: { cookie: mentorXCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: 6 }),
    });
    expect(tooHigh.statusCode).toBe(400);

    const nullRating = await app.inject({
      method: 'PATCH',
      url: `/api/mentor/applicants/${appAId}/review`,
      headers: { cookie: mentorXCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ shortlisted: true, starRating: null }),
    });
    expect(nullRating.statusCode).toBe(200);
    expect(nullRating.json().starRating).toBeNull();
  });
});
