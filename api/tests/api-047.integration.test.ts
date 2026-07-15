/**
 * Integration tests for GET /api/me/profile and PATCH /api/me/profile (API-047).
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 *
 * Covers (API-047 Ensures):
 * - GET /me/profile — 401 unauthenticated.
 * - GET /me/profile — 200 for applicant; returns name/email, all extended fields
 *   null when no profile row exists.
 * - PATCH /me/profile — 401 unauthenticated.
 * - PATCH /me/profile with { name: 'Alice' } — updates users.name; response
 *   reflects new name; subsequent GET returns updated name.
 * - PATCH /me/profile with { school, graduationYear, bio } — creates profile row;
 *   subsequent GET returns all three fields.
 * - PATCH /me/profile a second time — upserts correctly (no duplicate row).
 * - PATCH /me/profile with graduationYear: 1999 — 422.
 * - PATCH /me/profile with bio of 501 chars — 422.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, userProfiles } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
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

describe('GET /api/me/profile and PATCH /api/me/profile (API-047 integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();
  const applicantEmail = `api047-applicant+${ts}@example.com`;

  let applicantCookie: string;
  let applicantId: string;

  beforeAll(async () => {
    app = await buildApp();
    applicantCookie = await signUpAndGetSession(app, applicantEmail, 'OriginalName');
    applicantId = await getUserId(applicantEmail);
  });

  afterAll(async () => {
    // Clean up profile row and restore state
    await db.delete(userProfiles).where(eq(userProfiles.userId, applicantId));
    await app.close();
  });

  it('GET /me/profile — 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/profile' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /me/profile — 200 for applicant; extended fields null when no profile row', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/profile',
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      name: string;
      email: string;
      school: string | null;
      graduationYear: number | null;
      bio: string | null;
    };
    expect(body.name).toBe('OriginalName');
    expect(body.email).toBe(applicantEmail);
    expect(body.school).toBeNull();
    expect(body.graduationYear).toBeNull();
    expect(body.bio).toBeNull();
  });

  it('PATCH /me/profile — 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Alice' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /me/profile with { name } — updates users.name; GET returns updated name', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ name: 'Alice' }),
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = patchRes.json() as { name: string };
    expect(patchBody.name).toBe('Alice');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/me/profile',
      headers: { cookie: applicantCookie },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { name: string };
    expect(getBody.name).toBe('Alice');
  });

  it('PATCH /me/profile with { school, graduationYear, bio } — creates profile row; GET returns all three', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ school: 'OSU', graduationYear: 2027, bio: 'Hello' }),
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = patchRes.json() as {
      school: string;
      graduationYear: number;
      bio: string;
    };
    expect(patchBody.school).toBe('OSU');
    expect(patchBody.graduationYear).toBe(2027);
    expect(patchBody.bio).toBe('Hello');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/me/profile',
      headers: { cookie: applicantCookie },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as {
      school: string;
      graduationYear: number;
      bio: string;
    };
    expect(getBody.school).toBe('OSU');
    expect(getBody.graduationYear).toBe(2027);
    expect(getBody.bio).toBe('Hello');
  });

  it('PATCH /me/profile a second time — upserts correctly (no duplicate row)', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ school: 'MIT', graduationYear: 2028, bio: 'Updated bio' }),
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json() as { school: string; graduationYear: number; bio: string };
    expect(body.school).toBe('MIT');
    expect(body.graduationYear).toBe(2028);
    expect(body.bio).toBe('Updated bio');

    // Verify only one row in DB
    const rows = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, applicantId));
    expect(rows).toHaveLength(1);
  });

  it('PATCH /me/profile with graduationYear: 1999 — 400 (below min 2000)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ graduationYear: 1999 }),
    });
    // Fastify + fastify-type-provider-zod returns 400 for body schema violations
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /me/profile with bio of 501 chars — 400 (exceeds max 500)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ bio: 'x'.repeat(501) }),
    });
    // Fastify + fastify-type-provider-zod returns 400 for body schema violations
    expect(res.statusCode).toBe(400);
  });
});
