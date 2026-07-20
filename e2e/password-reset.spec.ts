/**
 * E2E password-reset flow — TEST-016
 *
 * CI-only: skips cleanly on local runs (process.env.CI not set).
 * Does NOT use the shared applicantSession fixture — provisions a fresh user
 * per run so password rotation does not pollute shared session state.
 *
 * Full round-trip:
 *   sign-up → forgot-password → extract reset URL → reset → sign-in → sign-out
 *   → reject old password
 */

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import { generateSync } from 'otplib';
import { extractResetUrl } from './fixtures/logCapture.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6080';

const OLD_PASSWORD = 'Test1234!';
const NEW_PASSWORD = 'NewP@ssw0rd!';

// ---------------------------------------------------------------------------
// Helper — provision a fresh user with TOTP enrolled
// ---------------------------------------------------------------------------

async function createApplicantWithTotp(): Promise<{
  email: string;
  password: string;
  totpSecret: string;
}> {
  const email = `reset+${randomUUID()}@example.com`;

  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });

  // 1. Sign up
  const signUpRes = await ctx.post(`${API_BASE}/api/auth/sign-up`, {
    data: { email, password: OLD_PASSWORD, name: email },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!signUpRes.ok()) {
    throw new Error(`Sign-up failed: ${signUpRes.status()} ${await signUpRes.text()}`);
  }

  // 2. Enable TOTP
  const enableRes = await ctx.post(`${API_BASE}/api/auth/two-factor/enable`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  if (!enableRes.ok()) {
    throw new Error(`TOTP enable failed: ${enableRes.status()} ${await enableRes.text()}`);
  }
  const { totpURI } = (await enableRes.json()) as { totpURI: string };

  // 3. Parse secret and generate a valid TOTP code
  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error('No TOTP secret in URI');
  const code = generateSync({ secret });

  // 4. Verify TOTP (completes enrolment)
  const verifyRes = await ctx.post(`${API_BASE}/api/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!verifyRes.ok()) {
    throw new Error(`TOTP verify failed: ${verifyRes.status()} ${await verifyRes.text()}`);
  }

  await ctx.dispose();

  return { email, password: OLD_PASSWORD, totpSecret: secret };
}

// ---------------------------------------------------------------------------
// Test — full forgot → reset → sign-in round-trip
// ---------------------------------------------------------------------------

test.describe('Password-reset round-trip', () => {
  test.skip(!process.env['CI'], 'Password-reset E2E is CI-only (requires docker logs capture)');

  test('forgot → email → reset URL → new password → sign-in → old password rejected', async ({
    page,
    request,
  }) => {
    // ── STEP 1: Provision a fresh applicant ──────────────────────────────────
    const { email } = await createApplicantWithTotp();

    // ── STEP 2: Navigate to /forgot-password, submit email ───────────────────
    await page.goto('/forgot-password');
    await page.fill('#email', email);
    await page.click('button[type="submit"]');

    // Assert anti-enumeration success message renders
    await expect(page.getByText('If that address is registered, a reset link is on its way.')).toBeVisible({
      timeout: 10_000,
    });

    // ── STEP 3: Retrieve the reset URL from container stdout ─────────────────
    const resetUrl = await extractResetUrl(email, { timeoutMs: 15_000 });
    expect(resetUrl).toMatch(/\/reset-password\?token=/);

    // ── STEP 4: Navigate to the reset URL ────────────────────────────────────
    await page.goto(resetUrl);

    // Confirm we are on the reset-password page
    await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible({
      timeout: 10_000,
    });

    // ── STEP 5: Submit new password, assert redirect to /sign-in ─────────────
    await page.fill('#newPassword', NEW_PASSWORD);
    await page.fill('#confirmPassword', NEW_PASSWORD);
    await page.click('button[type="submit"]');

    // Should redirect to /sign-in with "Password updated" state message
    await page.waitForURL('**/sign-in', { timeout: 15_000 });
    await expect(page.getByText('Password updated')).toBeVisible({ timeout: 5_000 });

    // ── STEP 6: Sign in with the new password ────────────────────────────────
    await page.fill('#email', email);
    await page.fill('#password', NEW_PASSWORD);
    await page.click('button[type="submit"]');

    // Assert landing on /
    await page.waitForURL('**/', { timeout: 15_000 });
    await expect(page).toHaveURL('/');

    // ── STEP 7: Sign out ─────────────────────────────────────────────────────
    const signOutRes = await request.post(`${API_BASE}/api/auth/sign-out`, {
      headers: { 'Content-Type': 'application/json' },
    });
    // Better Auth returns 200 on sign-out
    expect(signOutRes.ok()).toBeTruthy();

    // Clear browser cookies/session so the next sign-in attempt is truly fresh
    await page.context().clearCookies();

    // ── STEP 8: Attempt sign-in with old password — must fail ────────────────
    await page.goto('/sign-in');
    await page.fill('#email', email);
    await page.fill('#password', OLD_PASSWORD);
    await page.click('button[type="submit"]');

    // Expect an error message — sign-in should fail with old password
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10_000 });

    // Confirm we did NOT land on /
    expect(page.url()).not.toMatch(/\/$/);
  });
});
