/**
 * Integration tests for the readiness-config endpoints (API-042, PM036).
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 * Auth/role helpers modelled on api-030.integration.test.ts.
 *
 * Covers (API-042 Ensures):
 * - GET as any authed user → 200, numeric wGoal/wVerified/wBreadth; on a freshly
 *   seeded DB they equal 0.6 / 0.25 / 0.15.
 * - GET unauthenticated → 401.
 * - PUT as admin → 200 echoing the new values; a subsequent GET reflects them.
 * - PUT as non-admin → 403.
 * - PUT unauthenticated → 401.
 * - PUT with an out-of-range weight (1.5) → 400.
 *
 * The suite restores the seeded defaults in afterAll so it is idempotent and does
 * not leave the single-row table mutated for other integration files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles, readinessConfig } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

async function signUpAndGetSession(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'API-042 User', email, password: 'Password123!' }),
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

describe('readiness-config endpoints (API-042 integration)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  const adminEmail = `api042-admin+${ts}@example.com`;
  const applicantEmail = `api042-applicant+${ts}@example.com`;

  let adminCookie: string;
  let applicantCookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();

    adminCookie = await signUpAndGetSession(app, adminEmail);
    applicantCookie = await signUpAndGetSession(app, applicantEmail);

    adminId = await getUserId(adminEmail);
    await db.insert(systemRoles).values({ userId: adminId, role: 'admin' }).onConflictDoNothing();

    // Ensure the seeded default row exists and holds the canonical defaults so
    // the GET-defaults assertion is deterministic regardless of prior state.
    await db
      .insert(readinessConfig)
      .values({ id: 'default', wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: readinessConfig.id,
        set: { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() },
      });
  });

  afterAll(async () => {
    // Restore seeded defaults so the single-row table is left untouched.
    await db
      .insert(readinessConfig)
      .values({ id: 'default', wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: readinessConfig.id,
        set: { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() },
      });
    await app.close();
  });

  it('GET unauthenticated → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/readiness-config' });
    expect(res.statusCode).toBe(401);
  });

  it('GET as any authed user → 200 with numeric defaults including platinumHours', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/readiness-config',
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { wGoal: number; wVerified: number; wBreadth: number; platinumHours: number };
    expect(body.wGoal).toBe(0.6);
    expect(body.wVerified).toBe(0.25);
    expect(body.wBreadth).toBe(0.15);
    expect(body.platinumHours).toBe(1000);
  });

  it('PUT unauthenticated → 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/readiness-config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('PUT as non-admin → 403', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/readiness-config',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT out-of-range weight (1.5) → 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/readiness-config',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ wGoal: 1.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT as admin → 200 echoing new values; subsequent GET reflects them', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/readiness-config',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 500 }),
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json() as { wGoal: number; wVerified: number; wBreadth: number; platinumHours: number };
    expect(putBody).toEqual({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 500 });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/readiness-config',
      headers: { cookie: adminCookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 500 });
  });
});
