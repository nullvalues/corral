// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6050)
//   UI:  pnpm --filter @asp/ui dev   (port 6051)
// Pre-requisite: none (test is self-contained; creates all users fresh)
// Not included in CI — intended for local pre-merge runs.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { generateSync } from 'otplib';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// ---------------------------------------------------------------------------
// createUserWithTotp — provisions a fresh user, enables TOTP, verifies it,
// and returns { email, password, userId }.
// ---------------------------------------------------------------------------

async function createUserWithTotp(): Promise<{ email: string; password: string; userId: string }> {
  const email = `user+${randomUUID()}@example.com`;
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
// signInAsUser — navigates to /sign-in, fills credentials, waits for root.
// ---------------------------------------------------------------------------

async function signInAsUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  // Wait until we land on the protected root route
  await page.waitForURL('**/', { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Admin + Mentor full flow', () => {
  test('admin creates category + grant → mentor enters mode → edits → revocation', async ({ browser }) => {
    // ── STEP 1: Provision users ───────────────────────────────────────────────
    const userA = await createUserWithTotp(); // Applicant
    const userM = await createUserWithTotp(); // Mentor
    const userX = await createUserWithTotp(); // Admin

    // ── STEP 2: Bootstrap X as admin via adminPromote CLI ────────────────────
    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl) throw new Error('DATABASE_URL must be set to run this E2E test');
    const containerImage = process.env['CONTAINER_IMAGE'] ?? 'asp:local';
    if (process.env['CI']) {
      execFileSync('docker', [
        'run', '--rm', '--network', 'host',
        '-e', `DATABASE_URL=${dbUrl}`,
        containerImage,
        'admin:promote',
        `--email=${userX.email}`,
      ], { stdio: 'inherit' });
    } else {
      execFileSync('pnpm', [
        'tsx',
        'api/src/scripts/adminPromote.ts',
        `--email=${userX.email}`,
      ], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });
    }

    // ── STEP 3: Sign in as X → create category ───────────────────────────────
    const ctxX = await browser.newContext();
    const pageX = await ctxX.newPage();
    await signInAsUser(pageX, userX.email, userX.password);

    const categorySlug = `test-cat-${Date.now()}`;
    await pageX.goto('/admin/categories');

    // Click the "Create" button to open the inline form
    await pageX.getByRole('button', { name: /^Create$/i }).click();

    // Fill in the category form
    await pageX.locator('input[placeholder="e.g. clinical-work"]').fill(categorySlug);
    await pageX.locator('input[placeholder="Display name"]').fill('Test Category');

    // Submit — the form submit button says "Create Category"
    await pageX.getByRole('button', { name: 'Create Category' }).click();

    // Wait for the slug to appear in the category table
    await expect(pageX.getByText(categorySlug)).toBeVisible({ timeout: 10_000 });

    // ── STEP 4: X creates grant for M → A ────────────────────────────────────
    await pageX.goto('/admin/grants');

    // Search for mentor M — the first UserSearchSection has label "Search mentor"
    await pageX.locator('input[type="email"]').first().fill(userM.email);
    await pageX.getByRole('button', { name: 'Search' }).first().click();

    // Wait for results and click M's entry
    await expect(pageX.getByText(userM.email)).toBeVisible({ timeout: 10_000 });
    await pageX.getByText(userM.email).click();

    // Search for applicant A — the second UserSearchSection has label "Search applicant"
    await pageX.locator('input[type="email"]').last().fill(userA.email);
    await pageX.getByRole('button', { name: 'Search' }).last().click();
    await expect(pageX.getByText(userA.email)).toBeVisible({ timeout: 10_000 });
    await pageX.getByText(userA.email).click();

    // Check read + write permissions
    await pageX.getByLabel('Read').check();
    await pageX.getByLabel('Write').check();

    // Create grant
    await pageX.getByRole('button', { name: 'Create Grant' }).click();

    // Wait for grant list to refresh — the grants table shows mentorUserId
    await expect(pageX.getByText(userM.userId)).toBeVisible({ timeout: 10_000 });

    await ctxX.close();

    // ── STEP 5: Sign in as M → use ApplicantPicker → enter mentor mode ────────
    const ctxM = await browser.newContext();
    const pageM = await ctxM.newPage();
    await signInAsUser(pageM, userM.email, userM.password);

    // Navigate to root so ProtectedLayout mounts with ApplicantPicker
    await pageM.goto('/');

    // The ApplicantPicker renders a <select> once hasMentorGrants is true
    const picker = pageM.locator('select');
    await expect(picker).toBeVisible({ timeout: 15_000 });

    // Select A's userId from the picker → navigates to /mentor/<A.id>/experiences
    await picker.selectOption({ value: userA.userId });
    await pageM.waitForURL(`**/mentor/${userA.userId}/experiences**`, { timeout: 10_000 });

    // Verify MentorBanner is visible
    await expect(pageM.getByText(/Viewing on behalf of/)).toBeVisible({ timeout: 5_000 });

    // ── STEP 6: M creates an experience for A ─────────────────────────────────
    const orgName = `Mentor Test Org ${Date.now()}`;

    // Wait for page to fully load
    await pageM.waitForLoadState('networkidle');

    const addFirstBtn = pageM.getByRole('button', { name: /Add your first experience/i });
    const addBtn = pageM.getByRole('button', { name: /^Add$/i });
    const hasFirstCta = await addFirstBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasFirstCta) {
      await addFirstBtn.click();
    } else {
      await addBtn.click();
    }

    await pageM.fill('input[placeholder="Organization name"]', orgName);
    await pageM.fill('input[placeholder="Your role or title"]', 'Research Mentor');
    await pageM.fill('input[type="date"]:first-of-type', '2023-01-01');
    await pageM.click('button[type="submit"]:not([disabled])');

    // Wait for form to close and experience to appear
    await expect(pageM.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(pageM.getByText(orgName)).toBeVisible({ timeout: 5_000 });

    // ── STEP 7: 403 — M has no grant for X; accessing X's experiences returns 403
    const res403 = await pageM.request.get(
      `${API_BASE}/api/experiences?owner_user_id=${encodeURIComponent(userX.userId)}`,
    );
    expect(res403.status()).toBe(403);

    // ── STEP 8: Admin X revokes the grant ─────────────────────────────────────
    const ctxX2 = await browser.newContext();
    const pageX2 = await ctxX2.newPage();
    await signInAsUser(pageX2, userX.email, userX.password);
    await pageX2.goto('/admin/grants');

    // Find the row for M's userId and click Revoke
    const grantRow = pageX2.locator('tr').filter({ hasText: userM.userId });
    await expect(grantRow).toBeVisible({ timeout: 10_000 });
    await grantRow.getByRole('button', { name: 'Revoke' }).click();

    // Wait for status to change to revoked
    await expect(grantRow.getByText('revoked')).toBeVisible({ timeout: 10_000 });
    await ctxX2.close();

    // ── STEP 9: M tries mentor mode → redirected away (grant revoked) ──────────
    // Navigate directly to mentor URL; MentorScopeLayout redirects since grant inactive
    await pageM.goto(`/mentor/${userA.userId}/experiences`);
    await pageM.waitForURL('**/experiences', { timeout: 10_000 });
    expect(pageM.url()).not.toContain('/mentor/');

    await ctxM.close();
  });
});
