// E2E tests require live dev servers (or the production container in CI):
//   API: pnpm --filter @asp/api dev  (port 6050)
//   UI:  pnpm --filter @asp/ui dev   (port 6051)
// Pre-requisite: none (test is self-contained; creates all users fresh).
//
// Smoke test of the user management flow (TEST-039): an admin uses the
// UsersAdminPage to promote a freshly-created applicant to admin, then the
// promoted user signs in and reaches /admin.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { generateSync } from 'otplib';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// ---------------------------------------------------------------------------
// createUserWithTotp — provisions a fresh user, enables TOTP, verifies it,
// and returns { email, password, userId }. An optional emailPrefix lets the
// caller control the lexical sort order of the email (the user list is ordered
// by email, so a low-sorting prefix guarantees the row lands on page 1).
// ---------------------------------------------------------------------------

async function createUserWithTotp(
  emailPrefix = 'user',
): Promise<{ email: string; password: string; userId: string }> {
  const email = `${emailPrefix}+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });

  // 1. Sign up
  const signUpRes = await ctx.post(`${API_BASE}/api/auth/sign-up`, {
    data: { email, password, name: email },
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

  // 3. Parse secret and generate a valid code
  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error('No TOTP secret in URI');
  const code = generateSync({ secret });

  // 4. Verify TOTP
  const verifyRes = await ctx.post(`${API_BASE}/api/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!verifyRes.ok()) {
    throw new Error(`TOTP verify failed: ${verifyRes.status()} ${await verifyRes.text()}`);
  }

  // 5. Get user ID
  const meRes = await ctx.get(`${API_BASE}/api/me`);
  if (!meRes.ok()) {
    throw new Error(`GET /api/me failed: ${meRes.status()} ${await meRes.text()}`);
  }
  const meBody = (await meRes.json()) as { user: { id: string } };
  const userId = meBody.user.id;

  await ctx.dispose();

  return { email, password, userId };
}

// ---------------------------------------------------------------------------
// promoteToAdmin — bootstraps a user to admin via the adminPromote CLI
// (locally) or the production container (CI), matching the adminSession fixture.
// ---------------------------------------------------------------------------

function promoteToAdmin(email: string): void {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL must be set to run this E2E test');
  const containerImage = process.env['CONTAINER_IMAGE'] ?? 'asp:local';

  if (process.env['CI']) {
    execFileSync('docker', [
      'run', '--rm', '--network', 'host',
      '-e', `DATABASE_URL=${dbUrl}`,
      containerImage,
      'admin:promote',
      `--email=${email}`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('pnpm', [
      'tsx',
      'api/src/scripts/adminPromote.ts',
      `--email=${email}`,
    ], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });
  }
}

// ---------------------------------------------------------------------------
// signInAsUser — navigates to /sign-in, fills credentials, waits for navigation
// away from /sign-in (admins land on /admin, applicants on /experiences).
// ---------------------------------------------------------------------------

async function signInAsUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.endsWith('/sign-in'), { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Admin user management', () => {
  test('admin promotes applicant to admin; promoted user reaches /admin', async ({ browser }) => {
    // ── STEP 1: Provision a fresh applicant and a fresh admin ─────────────────
    // The applicant email uses an 'aaa-' prefix so it sorts to the top of the
    // email-ordered user list and is guaranteed to appear on page 1.
    const applicant = await createUserWithTotp('aaa-test039-applicant');
    const admin = await createUserWithTotp('admin');

    // ── STEP 2: Bootstrap the admin ───────────────────────────────────────────
    promoteToAdmin(admin.email);

    // ── STEP 3: Sign in as admin → navigate to /admin/users ───────────────────
    const ctxAdmin = await browser.newContext();
    const pageAdmin = await ctxAdmin.newPage();
    await signInAsUser(pageAdmin, admin.email, admin.password);

    await pageAdmin.goto('/admin/users');

    // The user table renders once the list loads.
    await expect(pageAdmin.getByRole('heading', { name: 'Users' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageAdmin.locator('table')).toBeVisible({ timeout: 15_000 });

    // ── STEP 4: Find the applicant row and promote ───────────────────────────
    const applicantRow = pageAdmin.locator('tr').filter({ hasText: applicant.email });
    await expect(applicantRow).toBeVisible({ timeout: 15_000 });

    // Confirm the window.confirm() dialog that precedes the mutation.
    pageAdmin.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await applicantRow.getByRole('button', { name: 'Make admin' }).click();

    // ── STEP 5: The row's role badges now include 'admin' ────────────────────
    await expect(applicantRow.getByText('admin', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await ctxAdmin.close();

    // ── STEP 6: The promoted user signs in fresh and reaches /admin ──────────
    const ctxPromoted = await browser.newContext();
    const pagePromoted = await ctxPromoted.newPage();
    await signInAsUser(pagePromoted, applicant.email, applicant.password);

    await pagePromoted.goto('/admin');
    await pagePromoted.waitForURL('**/admin**', { timeout: 15_000 });
    expect(pagePromoted.url()).toContain('/admin');
    // AdminLayout would have bounced a non-admin to /experiences.
    expect(pagePromoted.url()).not.toContain('/experiences');

    await ctxPromoted.close();
  });
});
