/**
 * TEST-011 — Full password-reset round-trip via mock mailer.
 *
 * Verifies the complete password-reset flow:
 *   1. Sign up a fresh user.
 *   2. Request a password reset — mock mailer captures the reset URL.
 *   3. Extract the token from the captured URL (BA puts it in the path segment).
 *   4. Reset the password with the token.
 *   5. Sign in with the new password — assert success.
 *   6. Replay the same token — assert non-200 (token consumed).
 *
 * BA's requestPasswordReset uses `redirectTo` (not `callbackURL`) in the request
 * body. The URL passed to sendResetPassword has the form:
 *   ${baseURL}/reset-password/${token}?callbackURL=${encodedRedirectTo}
 * so the token lives in the path segment (second-to-last path component).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which requires
 * DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup before
 * the first test. No graceful skip — if DATABASE_URL_TEST is absent, globalSetup
 * throws a clear error.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { setMailer } from '../src/services/auth/index.js';
import type { MailerClient } from '../src/lib/mailer.js';
import { db } from '../src/db/index.js';
import { users, systemRoles } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

// ─── Mock mailer ─────────────────────────────────────────────────────────────

const calls: Array<{ to: string; resetUrl: string }> = [];

const mockMailer: MailerClient = {
  sendPasswordReset: async (opts) => {
    calls.push(opts);
  },
  sendExperienceVerified: async () => {},
  sendExperienceUnverified: async () => {},
};

// ─── Cleanup tracking ────────────────────────────────────────────────────────

let createdUserId: string | null = null;
const TEST_EMAIL = `pw-reset-${Date.now()}@test.com`;
const ORIGINAL_PASSWORD = 'Password123!';
const NEW_PASSWORD = 'NewPassword123!';

afterAll(async () => {
  if (createdUserId) {
    // Delete soft-FK rows first (system_roles), then the BA-owned user row.
    await db.delete(systemRoles).where(eq(systemRoles.userId, createdUserId));
    await db.delete(users).where(eq(users.id, createdUserId));
    createdUserId = null;
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('password-reset round-trip (TEST-011)', () => {
  beforeEach(() => {
    // Reset call capture between tests.
    calls.length = 0;
    // Wire mock into the BA sendResetPassword callback before each test.
    setMailer(mockMailer);
  });

  it('full round-trip: request → capture token → reset → sign-in with new password', async () => {
    // Build the app with the mock mailer injected via both channels:
    //  1. buildApp({ mailerClient }) → wires the Fastify decorator
    //  2. setMailer() (called in beforeEach) → wires the BA sendResetPassword callback
    const app = await buildApp({ mailerClient: mockMailer });
    try {
      // ── Step 1: Sign up a fresh user ──────────────────────────────────────
      const signUpRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Reset Test User',
          email: TEST_EMAIL,
          password: ORIGINAL_PASSWORD,
        }),
      });
      expect(signUpRes.statusCode).toBe(200);
      const signUpBody = JSON.parse(signUpRes.body) as { user?: { id?: string } };
      const userId = signUpBody.user?.id;
      expect(userId).toBeTruthy();
      createdUserId = userId ?? null;

      // ── Step 2: Request a password reset ──────────────────────────────────
      // BA's endpoint body uses `redirectTo` (not `callbackURL`).
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/auth/request-password-reset',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          email: TEST_EMAIL,
          redirectTo: 'http://localhost/reset-password',
        }),
      });
      expect(requestRes.statusCode).toBe(200);

      // ── Step 3: Assert mock mailer was called ─────────────────────────────
      expect(calls.length).toBe(1);
      expect(calls[0].to).toBe(TEST_EMAIL);
      const capturedResetUrl = calls[0].resetUrl;
      expect(capturedResetUrl).toBeTruthy();

      // ── Step 4: Extract token from the captured URL ───────────────────────
      // BA constructs: ${baseURL}/reset-password/${token}?callbackURL=${encoded}
      // The token is the last path segment before the query string.
      // Example: http://localhost/api/auth/reset-password/abc123?callbackURL=...
      const parsedUrl = new URL(capturedResetUrl);
      const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
      // Last segment is the token (path: /api/auth/reset-password/<token>)
      const token = pathSegments[pathSegments.length - 1];
      expect(token).toBeTruthy();
      expect(token!.length).toBeGreaterThan(0);

      // ── Step 5: Reset the password with the token ─────────────────────────
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          token,
          newPassword: NEW_PASSWORD,
        }),
      });
      expect(resetRes.statusCode).toBe(200);

      // ── Step 6: Sign in with the new password ─────────────────────────────
      const signInRes = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          email: TEST_EMAIL,
          password: NEW_PASSWORD,
        }),
      });
      expect(signInRes.statusCode).toBe(200);

      // ── Step 7: Replay the same token — must be rejected (consumed) ───────
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          token,
          newPassword: 'AnotherPassword1!',
        }),
      });
      expect(replayRes.statusCode).not.toBe(200);
    } finally {
      await app.close();
    }
  });
});
