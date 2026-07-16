// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6050)
//   UI:  pnpm --filter @asp/ui dev   (port 6051)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.

import { test, expect } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import * as fs from 'fs';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// Set up the session before all tests in this file (once).
test.beforeAll(async () => {
  // Only set up if the session file doesn't already exist (allows reuse across
  // multiple spec files that share the same session).
  if (!fs.existsSync(applicantSessionFile)) {
    await setupApplicantSession();
  }
});

// All tests in this file use the stored session — no sign-in required.
test.use({
  storageState: applicantSessionFile,
  viewport: { width: 1280, height: 800 },
});

test.describe('Experience CRUD round-trip', () => {
  test('create → assert in table + rollup → edit → delete → row gone', async ({ page, request }) => {
    // ── Determine the first active category ───────────────────────────────────
    const catRes = await request.get(`${API_BASE}/api/experience-categories`);
    expect(catRes.ok()).toBeTruthy();
    const categories = (await catRes.json()) as Array<{
      id: string;
      slug: string;
      name: string;
      isActive: boolean;
      sortOrder: number;
    }>;
    const activeCategories = categories
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(activeCategories.length).toBeGreaterThan(0);
    const firstCategory = activeCategories[0];

    // ── Navigate to the experiences page ─────────────────────────────────────
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    // ── Open the create form ──────────────────────────────────────────────────
    // If there are no experiences the CTA button shows; otherwise the "Add" button.
    const addFirstBtn = page.getByRole('button', { name: /Add your first experience/i });
    const addBtn = page.getByRole('button', { name: /^Add$/i });
    const hasFirstCta = await addFirstBtn.isVisible().catch(() => false);
    if (hasFirstCta) {
      await addFirstBtn.click();
    } else {
      await addBtn.click();
    }

    // ── Fill in the create form ───────────────────────────────────────────────
    const orgName = `Test Org ${Date.now()}`;
    await page.fill('input[placeholder="Organization name"]', orgName);
    await page.fill('input[placeholder="Your role or title"]', 'Test Researcher');
    await page.fill('input[type="date"]:first-of-type', '2023-01-01');

    // Hours triple: use values that satisfy totalHours = hoursPerWeek * numberOfWeeks
    // Default values are totalHours=1, hoursPerWeek=1, numberOfWeeks=1 — leave them
    // as-is since 1 = 1 * 1 satisfies the constraint.

    // Submit the form
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close (form disappears)
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // ── Assert the new experience appears in the table ────────────────────────
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 5000 });

    // Assert the experience-row data-testid is present
    const rows = page.locator('[data-testid="experience-row"]');
    await expect(rows.filter({ hasText: orgName })).toBeVisible();

    // ── Assert rollup total is updated ───────────────────────────────────────
    // The rollup total should be at least 1 (totalHours from the new experience)
    const rollupText = await page.locator('tfoot td').textContent();
    expect(rollupText).toMatch(/Total hours: \d+/);
    const totalHours = parseInt(rollupText?.match(/Total hours: (\d+)/)?.[1] ?? '0', 10);
    expect(totalHours).toBeGreaterThanOrEqual(1);

    // ── Edit the experience (change organization name) ────────────────────────
    const updatedOrgName = `${orgName} (edited)`;
    const editBtn = rows.filter({ hasText: orgName }).getByRole('button', { name: /^Edit$/i });
    await editBtn.click();

    // Wait for edit modal
    await expect(page.getByRole('heading', { name: /Edit Experience/i })).toBeVisible({
      timeout: 5000,
    });

    // Clear and re-fill organization field
    const orgInput = page.locator('input[placeholder="Organization name"]');
    await orgInput.fill('');
    await orgInput.fill(updatedOrgName);

    // Submit the edit form
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Edit Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // Assert the updated organization name appears in the table
    await expect(page.getByText(updatedOrgName)).toBeVisible({ timeout: 5000 });

    // ── Delete the experience ─────────────────────────────────────────────────
    const deleteBtn = page
      .locator('[data-testid="experience-row"]')
      .filter({ hasText: updatedOrgName })
      .getByRole('button', { name: /^Delete$/i });
    await deleteBtn.click();

    // ── Assert the row is gone ────────────────────────────────────────────────
    await expect(
      page.locator('[data-testid="experience-row"]').filter({ hasText: updatedOrgName }),
    ).toHaveCount(0, { timeout: 5000 });
  });
});
