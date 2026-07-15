/**
 * Integration tests for API-034: verification fields in experience read responses.
 *
 * Verifies (the story's Ensures):
 *   - GET /api/experiences/:id includes `verificationStatus`, `verifiedByUserId`,
 *     `verifiedAt`.
 *   - Fresh experience: status 'unverified', verifiedByUserId null, verifiedAt null.
 *   - After a mentor verify: status 'verified', verifiedByUserId set to the mentor,
 *     verifiedAt non-null.
 *   - After a mentor un-verify: status back to 'unverified', verifiedByUserId/
 *     verifiedAt reset to null.
 *
 * The owner reads its own experience (ABAC isOwner), so contact PII is not gated
 * and no pii_access_log read row is written. The verify/un-verify mutations go
 * through the mentor (active write grant), mirroring API-033.
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
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-034 User', email, password: 'Password123!' }),
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

type ReadBody = {
  verificationStatus: string;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
};

describe('GET /api/experiences/:id verification fields (API-034)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const ownerEmail = `api034-owner+${ts}@example.com`;
  const mentorEmail = `api034-mentor+${ts}@example.com`;

  let ownerCookie: string;
  let mentorCookie: string;

  let ownerId: string;
  let mentorId: string;

  let categoryId: string;
  let experienceId: string;
  const grantId = `api034-grant-${ts}`;

  async function readAsOwner(): Promise<ReadBody> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/${experienceId}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ReadBody;
  }

  beforeAll(async () => {
    app = await buildApp();

    ownerCookie = await signUpAndGetSession(app, ownerEmail);
    mentorCookie = await signUpAndGetSession(app, mentorEmail);

    ownerId = await getUserId(ownerEmail);
    mentorId = await getUserId(mentorEmail);

    // Pure mentor holds no system role — remove the auto-assigned 'applicant'
    // role so it passes denyRole('applicant').
    await db.delete(systemRoles).where(inArray(systemRoles.userId, [mentorId]));

    const [category] = await db
      .insert(experienceCategories)
      .values({ slug: `api034-cat-${ts}`, name: 'API034 Category', sortOrder: 99, isActive: true })
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

    // Mentor grant with 'write' permission over the owner (needed for verify).
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

  it('fresh experience: unverified, null verifier and timestamp', async () => {
    const body = await readAsOwner();
    expect(body.verificationStatus).toBe('unverified');
    expect(body.verifiedByUserId).toBeNull();
    expect(body.verifiedAt).toBeNull();
  });

  it('after mentor verify: status verified, verifiedByUserId set, verifiedAt non-null', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'verify' }),
    });
    expect(patch.statusCode).toBe(200);

    const body = await readAsOwner();
    expect(body.verificationStatus).toBe('verified');
    expect(body.verifiedByUserId).toBe(mentorId);
    expect(body.verifiedAt).not.toBeNull();
  });

  it('after mentor un-verify: status unverified, fields reset to null', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${experienceId}/verification`,
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify({ action: 'unverify' }),
    });
    expect(patch.statusCode).toBe(200);

    const body = await readAsOwner();
    expect(body.verificationStatus).toBe('unverified');
    expect(body.verifiedByUserId).toBeNull();
    expect(body.verifiedAt).toBeNull();
  });
});
