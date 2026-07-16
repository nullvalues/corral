// E2E authenticated workflow smoke tests — one per role.
//
// Pre-requisites:
//   - Running API + UI servers (API on :6050, UI on :6051)
//   - Seeded database: pnpm --filter @asp/api db:seed (creates active categories)
//   - UAT sessions: pnpm uat:setup (provisions applicant, mentor, admin storageState files)
//
// These tests load the pre-authenticated storageState produced by pnpm uat:setup,
// exercise each role's primary workflow, then sign out and assert the user is
// returned to the unauthenticated state.
//
// Not included in CI — intended for local pre-merge runs.

import { test, expect } from '@playwright/test';
import { storageStatePath as applicantStorageStatePath } from './uat/fixtures/applicantSession.js';
import { storageStatePath as mentorStorageStatePath } from './uat/fixtures/mentorSession.js';
import { storageStatePath as adminStorageStatePath } from './uat/fixtures/adminSession.js';

// ---------------------------------------------------------------------------
// Helper: sign out via the BA API and assert the user is redirected to /sign-in
// ---------------------------------------------------------------------------

async function signOutAndAssert(page: import('@playwright/test').Page): Promise<void> {
  // Call the BA sign-out endpoint from within the page request context so the
  // browser's session cookie is sent and invalidated.
  // Better Auth requires a trusted Origin for CSRF on sign-out. Playwright's
  // APIRequestContext doesn't set Origin automatically; set it to the UI origin
  // which is in trustedOrigins so Better Auth accepts the CSRF check.
  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:6051';
  const signOutRes = await page.request.post('/api/auth/sign-out', {
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
  });
  expect(signOutRes.ok()).toBeTruthy();

  // Clear browser cookies so the protected routes truly see no session.
  await page.context().clearCookies();

  // Navigate to a protected route — ProtectedLayout redirects to /sign-in when
  // no session is present.
  await page.goto('/experiences');
  await page.waitForURL('**/sign-in', { timeout: 10_000 });
  expect(page.url()).toContain('/sign-in');
}

// ---------------------------------------------------------------------------
// Applicant smoke test
// ---------------------------------------------------------------------------

test.describe('Workflow smoke — applicant', () => {
  test.use({
    storageState: applicantStorageStatePath,
    viewport: { width: 1280, height: 800 },
  });

  test('applicant views experiences list, clicks through to detail, then logs out', async ({ page }) => {
    // 1. Navigate to experiences. ExperiencesPage auto-redirects to the first
    //    active category slug.
    await page.goto('/experiences');
    await page.waitForURL('**/experiences/**', { timeout: 15_000 });

    // 2. Assert at least one experience row is visible.
    //    CategoryPage renders <tr data-testid="experience-row"> for each
    //    experience in the current category.
    const rows = page.locator('table tbody tr[data-testid="experience-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // 3. Click "Details" on the first row to open the detail flyout.
    await rows.first().getByRole('button', { name: 'Details' }).click();

    // 4. Assert the detail flyout heading is visible — confirms "click through to
    //    detail" without a URL change (the app uses a flyout, not a detail route).
    await expect(page.getByRole('heading', { name: 'Experience Details' })).toBeVisible({
      timeout: 5_000,
    });

    // 5. Sign out and assert redirect to /sign-in.
    await signOutAndAssert(page);
  });
});

// ---------------------------------------------------------------------------
// Mentor smoke test
// ---------------------------------------------------------------------------

test.describe('Workflow smoke — mentor', () => {
  test.use({
    storageState: mentorStorageStatePath,
    viewport: { width: 1280, height: 800 },
  });

  test('mentor views grants via ApplicantPicker, then logs out', async ({ page }) => {
    // 1. Navigate to the protected root. ProtectedLayout renders the ApplicantPicker
    //    in the top bar; it shows a <select> once hasMentorGrants === true.
    await page.goto('/');
    await page.waitForURL('**/', { timeout: 10_000 });

    // 2. Assert the ApplicantPicker select element is visible.
    //    The picker only renders when the mentor has at least one active grant
    //    — this is the "grant visible" assertion.
    const picker = page.locator('select');
    await expect(picker).toBeVisible({ timeout: 15_000 });

    // 3. Sign out and assert redirect to /sign-in.
    await signOutAndAssert(page);
  });
});

// ---------------------------------------------------------------------------
// Admin smoke test
// ---------------------------------------------------------------------------

test.describe('Workflow smoke — admin', () => {
  test.use({
    storageState: adminStorageStatePath,
    viewport: { width: 1280, height: 800 },
  });

  test('admin views experience categories list, then logs out', async ({ page }) => {
    // 1. Navigate to the admin categories page.
    await page.goto('/admin/categories');
    await page.waitForURL('**/admin/categories', { timeout: 10_000 });

    // 2. Assert at least one category row is visible. CategoriesAdminPage renders
    //    a <table> with one <tr> per category.
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // 3. Sign out and assert redirect to /sign-in.
    await signOutAndAssert(page);
  });
});
