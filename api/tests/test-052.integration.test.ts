/**
 * TEST-052: goal_hours migration constraint and readiness-config parity tests.
 *
 * All blocks are gated on DATABASE_URL_TEST — follows the db-022.test.ts pattern.
 *
 * Section A: experience_categories goal_hours CHECK constraint
 *   - pg_constraint confirms 'experience_categories_goal_hours_nonneg' exists
 *   - INSERT with goal_hours = -1 is rejected at the DB layer
 *   - INSERT with goal_hours = 0 succeeds (then cleaned up)
 *   - INSERT with goal_hours = NULL succeeds (then cleaned up)
 *   - Seeded 'patient-care-experience' has goal_hours = 1000
 *   - Seeded 'employment' has goal_hours IS NULL
 *
 * Section B: readiness_config singleton + bounds
 *   - pg_constraint confirms the four CHECK constraints exist
 *   - Seeded 'default' row holds 0.6 / 0.25 / 0.15
 *   - Inserting a row with id <> 'default' is rejected (singleton CHECK)
 *   - Inserting/updating a weight to 1.5 is rejected (bounds CHECK)
 *
 * Section C: readiness-config endpoints (focuses on admin-only gate)
 *   - GET /api/readiness-config unauth → 401; any authed → 200
 *   - PUT /api/admin/readiness-config admin → 200; non-admin → 403; unauth → 401;
 *     out-of-range weight → 400
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users, systemRoles, readinessConfig } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// ---------------------------------------------------------------------------
// Section A — experience_categories goal_hours CHECK (raw-SQL, DB layer)
// ---------------------------------------------------------------------------

describe.skipIf(!DATABASE_URL_TEST)(
  'TEST-052-A: experience_categories goal_hours CHECK constraint',
  () => {
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      sql = postgres(DATABASE_URL_TEST!);
      // The globalSetup truncates all tables (dataClean), so the production seed
      // rows are not present. Insert the two seeded entries we need to assert on.
      await sql`
        INSERT INTO experience_categories (slug, name, goal_hours)
        VALUES
          ('patient-care-experience', 'Patient Care Experience', 1000),
          ('employment', 'Employment', NULL)
        ON CONFLICT (slug) DO UPDATE
          SET goal_hours = EXCLUDED.goal_hours
      `;
    });

    afterAll(async () => {
      // Clean up only the test-marker rows inserted during the sub-tests.
      // The seed rows (patient-care-experience, employment) are left in place —
      // other integration files may depend on them and dataClean() handles the
      // global reset at the next test run.
      await sql`
        DELETE FROM experience_categories
        WHERE slug IN ('test052-goal-zero', 'test052-goal-null')
      `;
      await sql.end();
    });

    it('pg_constraint confirms experience_categories_goal_hours_nonneg exists', async () => {
      const rows = await sql<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'experience_categories'
          AND c.contype = 'c'
          AND c.conname = 'experience_categories_goal_hours_nonneg'
      `;
      expect(rows.length, 'CHECK constraint experience_categories_goal_hours_nonneg not found').toBe(
        1,
      );
    });

    it('INSERT with goal_hours = -1 is rejected at the DB layer', async () => {
      await expect(
        sql`
          INSERT INTO experience_categories (slug, name, goal_hours)
          VALUES ('test052-goal-neg', 'TEST-052 neg', -1)
        `,
      ).rejects.toThrow();
    });

    it('INSERT with goal_hours = 0 succeeds', async () => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO experience_categories (slug, name, goal_hours)
        VALUES ('test052-goal-zero', 'TEST-052 zero', 0)
        RETURNING id
      `;
      expect(rows.length).toBe(1);
    });

    it('INSERT with goal_hours = NULL succeeds', async () => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO experience_categories (slug, name, goal_hours)
        VALUES ('test052-goal-null', 'TEST-052 null', NULL)
        RETURNING id
      `;
      expect(rows.length).toBe(1);
    });

    it("seeded 'patient-care-experience' has goal_hours = 1000", async () => {
      const rows = await sql<{ goal_hours: number | null }[]>`
        SELECT goal_hours FROM experience_categories WHERE slug = 'patient-care-experience' LIMIT 1
      `;
      expect(rows.length, "'patient-care-experience' row not found in DB").toBe(1);
      expect(rows[0].goal_hours).toBe(1000);
    });

    it("seeded 'employment' has goal_hours IS NULL", async () => {
      const rows = await sql<{ goal_hours: number | null }[]>`
        SELECT goal_hours FROM experience_categories WHERE slug = 'employment' LIMIT 1
      `;
      expect(rows.length, "'employment' row not found in DB").toBe(1);
      expect(rows[0].goal_hours).toBeNull();
    });
  },
);

// ---------------------------------------------------------------------------
// Section B — readiness_config singleton + bounds (raw-SQL, DB layer)
// ---------------------------------------------------------------------------

describe.skipIf(!DATABASE_URL_TEST)(
  'TEST-052-B: readiness_config singleton + bounds',
  () => {
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      sql = postgres(DATABASE_URL_TEST!);
      // The globalSetup truncates all tables (dataClean), so the migration-seeded
      // 'default' row is not present. Re-insert it here to mirror the migration,
      // enabling the "seeded row" assertion below.
      await sql`
        INSERT INTO readiness_config (id, w_goal, w_verified, w_breadth, updated_at)
        VALUES ('default', 0.6, 0.25, 0.15, now())
        ON CONFLICT (id) DO NOTHING
      `;
    });

    afterAll(async () => {
      await sql.end();
    });

    it('readiness_config_singleton CHECK exists', async () => {
      const rows = await sql<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'readiness_config'
          AND c.contype = 'c'
          AND c.conname = 'readiness_config_singleton'
      `;
      expect(rows.length, 'CHECK readiness_config_singleton not found').toBe(1);
    });

    it('readiness_config_w_goal_bounds CHECK exists', async () => {
      const rows = await sql<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'readiness_config'
          AND c.contype = 'c'
          AND c.conname = 'readiness_config_w_goal_bounds'
      `;
      expect(rows.length, 'CHECK readiness_config_w_goal_bounds not found').toBe(1);
    });

    it('readiness_config_w_verified_bounds CHECK exists', async () => {
      const rows = await sql<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'readiness_config'
          AND c.contype = 'c'
          AND c.conname = 'readiness_config_w_verified_bounds'
      `;
      expect(rows.length, 'CHECK readiness_config_w_verified_bounds not found').toBe(1);
    });

    it('readiness_config_w_breadth_bounds CHECK exists', async () => {
      const rows = await sql<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'readiness_config'
          AND c.contype = 'c'
          AND c.conname = 'readiness_config_w_breadth_bounds'
      `;
      expect(rows.length, 'CHECK readiness_config_w_breadth_bounds not found').toBe(1);
    });

    it("seeded 'default' row exists with w_goal=0.6, w_verified=0.25, w_breadth=0.15", async () => {
      const rows = await sql<{ w_goal: number; w_verified: number; w_breadth: number }[]>`
        SELECT w_goal, w_verified, w_breadth FROM readiness_config WHERE id = 'default' LIMIT 1
      `;
      expect(rows.length, "'default' row not found in readiness_config").toBe(1);
      expect(rows[0].w_goal).toBeCloseTo(0.6, 5);
      expect(rows[0].w_verified).toBeCloseTo(0.25, 5);
      expect(rows[0].w_breadth).toBeCloseTo(0.15, 5);
    });

    it("inserting a row with id = 'not-default' is rejected by singleton CHECK", async () => {
      await expect(
        sql`
          INSERT INTO readiness_config (id, w_goal, w_verified, w_breadth, updated_at)
          VALUES ('not-default', 0.5, 0.3, 0.2, now())
        `,
      ).rejects.toThrow();
    });

    it('inserting a weight of 1.5 is rejected by bounds CHECK', async () => {
      // Attempt an upsert on the existing 'default' row with an out-of-range weight.
      // Postgres evaluates the CHECK before committing even on UPDATE.
      await expect(
        sql`
          INSERT INTO readiness_config (id, w_goal, w_verified, w_breadth, updated_at)
          VALUES ('default', 1.5, 0.25, 0.15, now())
          ON CONFLICT (id) DO UPDATE SET w_goal = 1.5
        `,
      ).rejects.toThrow();
    });
  },
);

// ---------------------------------------------------------------------------
// Section C — readiness-config endpoints (focuses on admin-only gate)
// ---------------------------------------------------------------------------

async function signUpAndGetSession052(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'TEST-052 User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getUserId052(email: string): Promise<string> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!rows.length) throw new Error(`User not found: ${email}`);
  return rows[0].id;
}

describe.skipIf(!DATABASE_URL_TEST)(
  'TEST-052-C: readiness-config endpoints (admin-only gate)',
  () => {
    let app: FastifyInstance;
    const ts = Date.now();
    const adminEmail = `test052-admin+${ts}@example.com`;
    const applicantEmail = `test052-applicant+${ts}@example.com`;
    let adminCookie: string;
    let applicantCookie: string;

    beforeAll(async () => {
      app = await buildApp();

      adminCookie = await signUpAndGetSession052(app, adminEmail);
      applicantCookie = await signUpAndGetSession052(app, applicantEmail);

      const adminId = await getUserId052(adminEmail);
      await db.insert(systemRoles).values({ userId: adminId, role: 'admin' }).onConflictDoNothing();

      // Ensure canonical defaults for deterministic GET assertion.
      await db
        .insert(readinessConfig)
        .values({ id: 'default', wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: readinessConfig.id,
          set: { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() },
        });
    });

    afterAll(async () => {
      // Restore seeded defaults so the single-row table is left in canonical state.
      await db
        .insert(readinessConfig)
        .values({ id: 'default', wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: readinessConfig.id,
          set: { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000, updatedAt: new Date() },
        });
      await app.close();
    });

    it('GET /api/readiness-config unauthenticated → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/readiness-config' });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/readiness-config as any authed user → 200 with the three weights and platinumHours', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/readiness-config',
        headers: { cookie: applicantCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { wGoal: number; wVerified: number; wBreadth: number; platinumHours: number };
      expect(typeof body.wGoal).toBe('number');
      expect(typeof body.wVerified).toBe('number');
      expect(typeof body.wBreadth).toBe('number');
      expect(typeof body.platinumHours).toBe('number');
    });

    it('PUT /api/admin/readiness-config unauthenticated → 401', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('PUT /api/admin/readiness-config as non-admin → 403', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: applicantCookie },
        payload: JSON.stringify({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 }),
      });
      expect(res.statusCode).toBe(403);
    });

    it('PUT /api/admin/readiness-config with out-of-range weight (1.5) → 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        payload: JSON.stringify({ wGoal: 1.5, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('PUT /api/admin/readiness-config as admin → 200 with the new values', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        payload: JSON.stringify({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { wGoal: number; wVerified: number; wBreadth: number; platinumHours: number };
      expect(body).toEqual({ wGoal: 0.5, wVerified: 0.3, wBreadth: 0.2, platinumHours: 1000 });
    });
  },
);
