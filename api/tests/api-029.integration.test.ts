/**
 * Integration tests for API-029: GET /api/users paginated list mode.
 *
 * Verifies:
 *   - Admin caller receives paginated list with role arrays and activeMentorGrantCount
 *   - Non-admin caller receives 403
 *   - ?email= branch still returns typeahead shape (regression guard)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
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
    payload: JSON.stringify({ name: 'API-029 Test User', email, password: 'Password123!' }),
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

async function assignRole(userId: string, role: 'admin' | 'applicant'): Promise<void> {
  await db.insert(systemRoles).values({ userId, role }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/users — paginated list and typeahead', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let applicantCookie: string;

  const ts = Date.now();
  const adminEmail = `api029-admin+${ts}@example.com`;
  const applicantEmail = `api029-applicant+${ts}@example.com`;

  beforeAll(async () => {
    app = await buildApp();

    adminCookie = await signUpAndGetSession(app, adminEmail);
    applicantCookie = await signUpAndGetSession(app, applicantEmail);

    const adminId = await getUserId(adminEmail);
    await assignRole(adminId, 'admin');
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Paginated list branch
  // ---------------------------------------------------------------------------

  it('admin: GET /api/users?page=1&pageSize=10 → 200 with paginated shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users?page=1&pageSize=10',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      users: Array<{
        id: string;
        email: string;
        name: string;
        roles: string[];
        activeMentorGrantCount: number;
      }>;
      totalCount: number;
      page: number;
      pageSize: number;
    };
    expect(body).toHaveProperty('users');
    expect(body).toHaveProperty('totalCount');
    expect(body).toHaveProperty('page', 1);
    expect(body).toHaveProperty('pageSize', 10);
    expect(Array.isArray(body.users)).toBe(true);
    expect(typeof body.totalCount).toBe('number');

    // Each user row has required fields
    for (const u of body.users) {
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('email');
      expect(u).toHaveProperty('name');
      expect(Array.isArray(u.roles)).toBe(true);
      expect(typeof u.activeMentorGrantCount).toBe('number');
    }

    // totalCount must be at least 2 (our two seeded users).
    expect(body.totalCount).toBeGreaterThanOrEqual(2);
  });

  it('admin: seeded admin user has "admin" in roles array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users?page=1&pageSize=100',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      users: Array<{ email: string; roles: string[]; activeMentorGrantCount: number }>;
    };
    const adminRow = body.users.find((u) => u.email === adminEmail);
    expect(adminRow).toBeDefined();
    expect(adminRow!.roles).toContain('admin');
  });

  it('admin: activeMentorGrantCount is a non-negative integer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users?page=1&pageSize=100',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      users: Array<{ activeMentorGrantCount: number }>;
    };
    for (const u of body.users) {
      expect(u.activeMentorGrantCount).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(u.activeMentorGrantCount)).toBe(true);
    }
  });

  it('non-admin (applicant): GET /api/users?page=1&pageSize=10 → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users?page=1&pageSize=10',
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated: GET /api/users?page=1&pageSize=10 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users?page=1&pageSize=10',
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Typeahead branch (regression guard)
  // ---------------------------------------------------------------------------

  it('admin: GET /api/users?email=api029 → 200 with typeahead array shape', async () => {
    const prefix = `api029-admin+${ts}`;
    const res = await app.inject({
      method: 'GET',
      url: `/api/users?email=${encodeURIComponent(prefix)}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; email: string; name: string }>;
    expect(Array.isArray(body)).toBe(true);
    // Every element has just id/email/name (typeahead shape, not list shape)
    for (const u of body) {
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('email');
      expect(u).toHaveProperty('name');
      // typeahead shape does NOT have roles or activeMentorGrantCount
      expect(u).not.toHaveProperty('roles');
      expect(u).not.toHaveProperty('activeMentorGrantCount');
    }
    const emails = body.map((u) => u.email);
    expect(emails).toContain(adminEmail);
  });

  it('admin: GET /api/users with no params → 400 (schema refine)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
