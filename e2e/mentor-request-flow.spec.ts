// E2E tests require live dev servers (or the production container in CI):
//   API: pnpm --filter @asp/api dev  (port 6040)
//   UI:  pnpm --filter @asp/ui dev   (port 6041)
// Pre-requisite: none (test is self-contained; creates all users fresh).
//
// Full mentor-request lifecycle (TEST-041):
//   1. Applicant requests a mentor via ExperiencesPage → RequestMentorModal.
//   2. Applicant sees "Request pending" state.
//   3. Admin navigates to /admin/grants, finds the pending request, clicks Approve.
//   4. Pending request disappears; grant appears in the active grants list.
//   5. Mentor navigates to /experiences and sees the applicant in the ApplicantPicker.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { generateSync } from 'otplib';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';

// ---------------------------------------------------------------------------
// createUserWithTotp — provisions a fresh user, enables TOTP, verifies it,
// and returns { email, password, userId, secret }.
// ---------------------------------------------------------------------------

async function createUserWithTotp(emailPrefix = 'user'): Promise<{
  email: string;
  password: string;
  userId: string;
  secret: string;
}> {
  const email = `${emailPrefix}+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });

  // 1. Sign up
  const signUpRes = await ctx.post(`${API_BASE}/api/auth/sign-up`, {
    data: { email, password, name: email },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!signUpRes.ok()) {
    throw new Error(`Sign-up failed (${email}): ${signUpRes.status()} ${await signUpRes.text()}`);
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

  return { email, password, userId, secret };
}

// ---------------------------------------------------------------------------
// promoteToAdmin — bootstraps a user to admin via the adminPromote CLI
// (locally) or the production container (CI).
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
// away from /sign-in.
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

test.describe('Mentor request lifecycle', () => {
  test(
    'applicant requests mentor → admin approves → mentor sees applicant',
    async ({ browser }) => {
      // ── STEP 1: Provision three fresh accounts ──────────────────────────────
      // Prefix with 'mt041-' per story spec.
      const ts = Date.now();
      const applicant = await createUserWithTotp(`mt041-applicant-${ts}`);
      const mentor = await createUserWithTotp(`mt041-mentor-${ts}`);
      const admin = await createUserWithTotp(`mt041-admin-${ts}`);

      // ── STEP 2: Bootstrap the admin role ────────────────────────────────────
      promoteToAdmin(admin.email);

      // ── STEP 3: Applicant signs in and opens ExperiencesPage ────────────────
      const ctxApplicant = await browser.newContext();
      const pageApplicant = await ctxApplicant.newPage();

      await signInAsUser(pageApplicant, applicant.email, applicant.password);
      // Applicant lands on /experiences (role-based redirect)
      await pageApplicant.waitForURL('**/experiences**', { timeout: 15_000 });

      // The "No mentor assigned" section should be visible with a Request button
      await expect(
        pageApplicant.getByRole('button', { name: 'Request a mentor' }),
      ).toBeVisible({ timeout: 15_000 });

      // ── STEP 4: Applicant opens the modal and submits the mentor request ─────
      await pageApplicant.getByRole('button', { name: 'Request a mentor' }).click();

      // Modal should be visible
      await expect(pageApplicant.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
      await expect(pageApplicant.getByText('Request a mentor')).toBeVisible();

      // Fill in the mentor's email and submit
      await pageApplicant.fill('#mentor-email', mentor.email);
      await pageApplicant.getByRole('button', { name: 'Send request' }).click();

      // ── STEP 5: Applicant sees success confirmation in the modal ─────────────
      await expect(
        pageApplicant.getByRole('status').filter({ hasText: 'Request sent' }),
      ).toBeVisible({ timeout: 10_000 });

      // Close the modal
      await pageApplicant.getByRole('button', { name: 'Close' }).click();
      await expect(pageApplicant.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

      // ── STEP 6: Applicant sees "Request pending" state on ExperiencesPage ────
      await expect(
        pageApplicant.getByText('Mentor request pending', { exact: false }),
      ).toBeVisible({ timeout: 15_000 });

      // ── STEP 7: Admin signs in and navigates to /admin/grants ────────────────
      const ctxAdmin = await browser.newContext();
      const pageAdmin = await ctxAdmin.newPage();

      await signInAsUser(pageAdmin, admin.email, admin.password);
      await pageAdmin.goto('/admin/grants');

      // Wait for the page to load
      await expect(pageAdmin.getByRole('heading', { name: 'Mentor Grants' })).toBeVisible({
        timeout: 15_000,
      });

      // ── STEP 8: Admin sees the pending request and approves it ───────────────
      // The pending requests section renders only when pending grants exist.
      await expect(
        pageAdmin.getByRole('heading', { name: 'Pending Requests' }),
      ).toBeVisible({ timeout: 15_000 });

      // Find the row containing the applicant's email
      const pendingRow = pageAdmin
        .locator('section')
        .filter({ hasText: 'Pending Requests' })
        .locator('tr')
        .filter({ hasText: applicant.email });

      await expect(pendingRow).toBeVisible({ timeout: 15_000 });

      // Click Approve
      await pendingRow.getByRole('button', { name: 'Approve' }).click();

      // ── STEP 9: Pending request disappears from the queue ────────────────────
      // After approval the pending row should no longer be visible.
      await expect(pendingRow).not.toBeVisible({ timeout: 15_000 });

      // ── STEP 10: Applicant sees "active" mentor state ────────────────────────
      // Reload to pick up the invalidated query result.
      await pageApplicant.reload();
      await expect(
        pageApplicant.getByText('Mentor:', { exact: false }),
      ).toBeVisible({ timeout: 15_000 });

      // ── STEP 11: Mentor signs in and sees the applicant in the picker ─────────
      const ctxMentor = await browser.newContext();
      const pageMentor = await ctxMentor.newPage();

      await signInAsUser(pageMentor, mentor.email, mentor.password);
      await pageMentor.waitForURL('**/experiences**', { timeout: 15_000 });

      // The ApplicantPicker renders inside ProtectedLayout when hasMentorGrants=true.
      // It is a <select> with option "View as applicant…" plus the applicant's name/email.
      const picker = pageMentor.getByRole('combobox');
      await expect(picker).toBeVisible({ timeout: 15_000 });

      // The picker should contain an option for the applicant email (name falls back to email)
      await expect(picker.locator(`option[value="${applicant.userId}"]`)).toHaveCount(1, {
        timeout: 15_000,
      });

      await ctxApplicant.close();
      await ctxAdmin.close();
      await ctxMentor.close();
    },
  );
});
