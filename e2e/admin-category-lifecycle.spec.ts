// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6080)
//   UI:  pnpm --filter @asp/ui dev   (port 6081)
// Pre-requisite: DATABASE_URL must point to a running Postgres instance.
// Not included in CI — intended for local pre-merge runs.

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { generateSync } from 'otplib';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6080';

// ---------------------------------------------------------------------------
// createUserWithTotp — provisions a fresh user, enables TOTP, verifies it,
// and returns { email, password, userId }.
// ---------------------------------------------------------------------------

async function createUserWithTotp(): Promise<{ email: string; password: string; userId: string }> {
  const email = `user+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });

  const signUpRes = await ctx.post(`${API_BASE}/api/auth/sign-up`, {
    data: { email, password, name: email },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!signUpRes.ok()) {
    throw new Error(`Sign-up failed: ${signUpRes.status()} ${await signUpRes.text()}`);
  }

  const enableRes = await ctx.post(`${API_BASE}/api/auth/two-factor/enable`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  if (!enableRes.ok()) {
    throw new Error(`TOTP enable failed: ${enableRes.status()} ${await enableRes.text()}`);
  }
  const { totpURI } = (await enableRes.json()) as { totpURI: string };

  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error('No TOTP secret in URI');
  const code = generateSync({ secret });

  const verifyRes = await ctx.post(`${API_BASE}/api/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!verifyRes.ok()) {
    throw new Error(`TOTP verify failed: ${verifyRes.status()} ${await verifyRes.text()}`);
  }

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
// promoteToAdmin — promotes a user to admin via CLI (local) or Docker (CI).
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
// Tests
// ---------------------------------------------------------------------------

test.describe('Admin category lifecycle', () => {
  test('create → edit name → deactivate → applicant tab bar no longer shows category', async ({ browser }) => {
    // ── STEP 1: Provision users ───────────────────────────────────────────────
    const adminUser = await createUserWithTotp();
    const applicantUser = await createUserWithTotp();

    // ── STEP 2: Promote admin user ────────────────────────────────────────────
    promoteToAdmin(adminUser.email);

    // ── STEP 3: Sign in as admin ──────────────────────────────────────────────
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();

    await adminPage.goto('/sign-in');
    await adminPage.fill('#email', adminUser.email);
    await adminPage.fill('#password', adminUser.password);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL('**/', { timeout: 15_000 });

    // ── Scenario 1: Create category ───────────────────────────────────────────
    const categorySlug = `uat-test-cat-${Date.now()}`;
    const categoryName = 'UAT Test Category';

    await adminPage.goto('/admin/categories');

    // Click "Create" to open the inline form
    await adminPage.getByRole('button', { name: /^Create$/i }).click();

    // Fill slug and name
    await adminPage.locator('input[placeholder="e.g. clinical-work"]').fill(categorySlug);
    await adminPage.locator('input[placeholder="Display name"]').fill(categoryName);

    // Submit the form
    await adminPage.getByRole('button', { name: 'Create Category' }).click();

    // Assert the new category appears in the list
    await expect(adminPage.getByText(categorySlug)).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText(categoryName)).toBeVisible({ timeout: 5_000 });

    // ── Scenario 2: Edit name ─────────────────────────────────────────────────
    const renamedCategoryName = 'UAT Test Category Renamed';

    // Find the row for our category and click its Edit button
    const categoryRow = adminPage.locator('tr').filter({ hasText: categorySlug });
    await expect(categoryRow).toBeVisible({ timeout: 5_000 });
    await categoryRow.getByRole('button', { name: 'Edit' }).click();

    // Update the name field inside the inline edit form
    const nameInput = adminPage.locator('input[placeholder="Display name"]');
    await nameInput.clear();
    await nameInput.fill(renamedCategoryName);

    // Save the changes
    await adminPage.getByRole('button', { name: 'Save Changes' }).click();

    // Assert the updated name appears in the list
    await expect(adminPage.getByText(renamedCategoryName)).toBeVisible({ timeout: 10_000 });

    // ── Scenario 3: Deactivate and cross-role check ───────────────────────────
    // Deactivate the category
    const updatedRow = adminPage.locator('tr').filter({ hasText: categorySlug });
    await updatedRow.getByRole('button', { name: 'Deactivate' }).click();

    // Assert the row now shows "Inactive" status badge
    await expect(updatedRow.getByText('Inactive')).toBeVisible({ timeout: 10_000 });

    await adminCtx.close();

    // ── Cross-role check: applicant tab bar should not contain the category ────
    const applicantCtx = await browser.newContext();
    const applicantPage = await applicantCtx.newPage();

    await applicantPage.goto('/sign-in');
    await applicantPage.fill('#email', applicantUser.email);
    await applicantPage.fill('#password', applicantUser.password);
    await applicantPage.click('button[type="submit"]');
    await applicantPage.waitForURL('/', { timeout: 15_000 });

    // Navigate to experiences page
    await applicantPage.goto('/experiences');
    await applicantPage.waitForLoadState('networkidle');

    // The deactivated category tab must NOT be present in the tab bar
    const tabBar = applicantPage.getByRole('navigation', { name: 'Experience categories' });
    await expect(tabBar.getByText(renamedCategoryName)).not.toBeVisible({ timeout: 5_000 });

    await applicantCtx.close();
  });
});
