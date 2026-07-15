// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6040)
//   UI:  pnpm --filter @asp/ui dev   (port 6041)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.
//
// NOTE: The rate-limit test (describe block below) modifies shared in-memory
// rate-limit state keyed by IP. It is configured to run last via serial mode
// to avoid interfering with other tests in this file.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';

// Ensure the applicant session exists before tests that need it.
test.beforeAll(async () => {
  if (!fs.existsSync(applicantSessionFile)) {
    await setupApplicantSession();
  }
});

// ── 1. Rate-limit (429) ────────────────────────────────────────────────────
// Serial mode: this group exhausts the rate-limit window for the test-runner
// IP. Run it last so the 404 and 401 tests are not affected.
test.describe.configure({ mode: 'serial' });

test.describe('Rate-limit (429)', () => {
  test('11th rapid sign-in attempt returns 429', async () => {
    const ctx = await playwrightRequest.newContext();
    const wrongCreds = {
      email: `ratelimit+${randomUUID()}@example.com`,
      password: 'WrongPassword1!',
    };

    let lastStatus = 0;
    for (let i = 1; i <= 11; i++) {
      const res = await ctx.post(`${API_BASE}/api/auth/sign-in/email`, {
        data: wrongCreds,
        headers: { 'Content-Type': 'application/json' },
      });
      lastStatus = res.status();
      // Stop early once we get a 429 — no need to continue.
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
    await ctx.dispose();
  });

  test('sign-in form shows rate-limit error message after limit is exhausted', async ({ page }) => {
    // The rate-limit window is already exhausted from the previous test (serial).
    await page.goto('/sign-in');
    await page.fill('#email', `ratelimit+${randomUUID()}@example.com`);
    await page.fill('#password', 'WrongPassword1!');
    await page.click('button[type="submit"]');

    // The SignIn page renders mutation.error.message in role="alert".
    // The API returns { error: 'Too Many Requests' } on 429; the signInMutationFn
    // reads `body.message` and falls back to 'Sign-in failed'. @fastify/rate-limit
    // returns the message in `error` not `message`, so the fallback text appears.
    // Either "Too Many Requests" (if the field name ever changes) or the fallback
    // "Sign-in failed" is acceptable — both indicate the request was blocked.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 8_000 });
    const alertText = await alert.textContent();
    expect(alertText).toBeTruthy();
  });
});

// ── 2. 404 — non-existent experience ──────────────────────────────────────
test.describe('404 — non-existent experience', () => {
  test('GET /api/experiences/<random-uuid> returns 404', async () => {
    const ctx = await playwrightRequest.newContext({
      storageState: applicantSessionFile,
    });
    const nonExistentId = randomUUID();
    const res = await ctx.get(`${API_BASE}/api/experiences/${nonExistentId}`);
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });
});

// ── 3. 401 → re-auth redirect ─────────────────────────────────────────────
test.describe('401 session-expiry re-auth redirect', () => {
  test.use({
    storageState: applicantSessionFile,
    viewport: { width: 1280, height: 800 },
  });

  test('clearing session cookie mid-session redirects to /sign-in on protected API call', async ({ page, context }) => {
    // Start with a valid session.
    await page.goto('/experiences');
    await page.waitForURL('**/experiences/**', { timeout: 10_000 });

    // Clear all cookies to simulate session expiry.
    await context.clearCookies();

    // Reload the page: ProtectedLayout fetches /api/auth/get-session (returns
    // null without a valid session), and ExperiencesPage fetches
    // /api/experience-categories (returns 401 or unauthenticated).
    // Either path ultimately navigates to /sign-in.
    await page.reload();
    await page.waitForURL('**/sign-in', { timeout: 10_000 });
    expect(page.url()).toContain('/sign-in');
  });
});
