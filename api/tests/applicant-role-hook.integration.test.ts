/**
 * TEST-010 — Applicant role hook integration test.
 *
 * Verifies that Better Auth's `databaseHooks.user.create.after` hook correctly
 * inserts an `applicant` row into `system_roles` for every newly registered user.
 *
 * This is the signup-flow integration coverage for CER-004, previously deferred
 * from Phase 6 and delivered in Phase 10.
 *
 * These tests run in the "integration" Vitest project (TEST-001), which requires
 * DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup before
 * the first test. No graceful skip — if DATABASE_URL_TEST is absent, globalSetup
 * throws a clear error.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { systemRoles, users } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

// Track the userId created by this test for cleanup.
let createdUserId: string | null = null;

afterAll(async () => {
  if (createdUserId) {
    // Delete the system_roles row first (soft FK — no DB cascade), then the user.
    await db.delete(systemRoles).where(eq(systemRoles.userId, createdUserId));
    await db.delete(users).where(eq(users.id, createdUserId));
    createdUserId = null;
  }
});

describe('applicant role hook — signup integration (TEST-010)', () => {
  it('after sign-up, system_roles contains a row with role=applicant for the new user', async () => {
    const app = await buildApp();
    try {
      const email = `test-hook-${Date.now()}@test.com`;

      // Sign up a fresh user via the HTTP route.
      const signUpRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Hook Test User',
          email,
          password: 'Password123!',
        }),
      });

      expect(signUpRes.statusCode).toBe(200);
      const body = JSON.parse(signUpRes.body) as { user?: { id?: string } };
      const userId = body.user?.id;
      expect(userId).toBeTruthy();

      // Record for afterAll cleanup.
      createdUserId = userId ?? null;

      // Query system_roles directly via Drizzle.
      const rows = await db
        .select()
        .from(systemRoles)
        .where(eq(systemRoles.userId, userId!));

      // The hook must have inserted at least one row.
      expect(rows.length).toBeGreaterThanOrEqual(1);

      // The first row must be the applicant role.
      expect(rows[0].role).toBe('applicant');
    } finally {
      await app.close();
    }
  });
});
