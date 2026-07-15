// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6040)
//   UI:  pnpm --filter @asp/ui dev   (port 6041)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.
//
// This spec regression-guards UI-039: deleting an experience must show a
// window.confirm dialog. Dismissing it leaves the row intact; accepting it
// removes the row.

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';

// ---------------------------------------------------------------------------
// Shared state — an experience created in beforeAll, cleaned up in afterAll.
// ---------------------------------------------------------------------------

let experienceId = '';
let categorySlug = '';
let applicantCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

// ---------------------------------------------------------------------------
// beforeAll — provision the applicant session, create one experience.
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  await setupApplicantSession();

  applicantCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });

  // Resolve an active category so we can create the test experience.
  const catRes = await applicantCtx.get(`${API_BASE}/api/experience-categories`);
  expect(catRes.ok()).toBeTruthy();
  const categories = (await catRes.json()) as Array<{
    id: string;
    slug: string;
    isActive: boolean;
    sortOrder: number;
  }>;
  const active = categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  expect(active.length).toBeGreaterThan(0);
  const category = active[0];
  categorySlug = category.slug;

  // Create a test experience that the delete tests will operate on.
  const expRes = await applicantCtx.post(`${API_BASE}/api/experiences`, {
    data: {
      categoryId: category.id,
      organization: 'Delete-confirm E2E org',
      position: 'Delete-confirm position',
      frequency: 'temporary',
      startDate: '2024-03-01',
      dutiesNarrative: 'Testing the delete-confirm dialog gate end to end.',
      totalHours: 10,
      hoursPerWeek: 10,
      numberOfWeeks: 1,
      isCurrent: false,
      endDate: '2024-03-08',
      receivedAcademicCredit: false,
      receivedSalaryOrPayment: false,
      isVolunteer: false,
      isMostImportant: false,
      permissionToContact: false,
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(expRes.status()).toBe(201);
  const expBody = (await expRes.json()) as { id: string };
  experienceId = expBody.id;
});

// ---------------------------------------------------------------------------
// afterAll — delete the experience if it still exists (dismiss-dialog test
// leaves it in place; only the accept-dialog test removes it).
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  if (experienceId && applicantCtx) {
    // Best-effort cleanup — ignore the result (may already be deleted).
    await applicantCtx
      .delete(`${API_BASE}/api/experiences/${experienceId}`)
      .catch(() => undefined);
  }
  await applicantCtx?.dispose();
});

// ---------------------------------------------------------------------------
// Shared fixture use.
// ---------------------------------------------------------------------------

test.use({
  storageState: applicantSessionFile,
  viewport: { width: 1280, height: 800 },
});

// ---------------------------------------------------------------------------
// Test 1 — dismissing the confirm dialog leaves the experience row present.
// ---------------------------------------------------------------------------

test.describe('Experience delete confirmation gate (UI-039 regression guard)', () => {
  test('dismissing the confirm dialog leaves the experience row', async ({ page }) => {
    await page.goto(`/experiences/${categorySlug}`);
    await page.waitForLoadState('networkidle');

    // Wait for the row to appear.
    await page.waitForSelector('[data-testid="experience-row"]', { timeout: 15_000 });

    // Find the row for our test experience.
    const row = page.locator('[data-testid="experience-row"]', {
      hasText: 'Delete-confirm E2E org',
    });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Register a dialog handler that DISMISSES (cancel) the confirm.
    page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });

    // Click Delete.
    await row.getByRole('button', { name: 'Delete' }).click();

    // The row must still be present after dismiss.
    await expect(row).toBeVisible({ timeout: 5_000 });
  });

  // ── Test 2 — accepting the confirm dialog removes the experience row. ──────

  test('accepting the confirm dialog removes the experience row', async ({ page }) => {
    await page.goto(`/experiences/${categorySlug}`);
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="experience-row"]', { timeout: 15_000 });

    const row = page.locator('[data-testid="experience-row"]', {
      hasText: 'Delete-confirm E2E org',
    });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Register a dialog handler that ACCEPTS (confirm) the dialog.
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });

    // Click Delete.
    await row.getByRole('button', { name: 'Delete' }).click();

    // The row must no longer be present.
    await expect(row).not.toBeVisible({ timeout: 10_000 });

    // Clear the ID so afterAll does not try to double-delete.
    experienceId = '';
  });
});
