// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6080)
//   UI:  pnpm --filter @asp/ui dev   (port 6081)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.

import { test, expect } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import * as fs from 'fs';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6080';

// Set up the session before all tests in this file (once).
test.beforeAll(async () => {
  if (!fs.existsSync(applicantSessionFile)) {
    await setupApplicantSession();
  }
});

// All tests in this file use the stored session — no sign-in required.
test.use({
  storageState: applicantSessionFile,
  viewport: { width: 1280, height: 800 },
});

async function getFirstActiveCategory(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
): Promise<{ slug: string }> {
  const catRes = await request.get(`${API_BASE}/api/experience-categories`);
  expect(catRes.ok()).toBeTruthy();
  const categories = (await catRes.json()) as Array<{
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    sortOrder: number;
  }>;
  const active = categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  expect(active.length).toBeGreaterThan(0);
  return active[0];
}

async function openCreateForm(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  const addFirstBtn = page.getByRole('button', { name: /Add your first experience/i });
  const addBtn = page.getByRole('button', { name: /^Add$/i });
  const hasFirstCta = await addFirstBtn.isVisible().catch(() => false);
  if (hasFirstCta) {
    await addFirstBtn.click();
  } else {
    await addBtn.click();
  }
}

async function fillRequiredFields(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  orgName: string,
) {
  await page.fill('input[placeholder="Organization name"]', orgName);
  await page.fill('input[placeholder="Your role or title"]', 'Tester');
  await page.fill('input[type="date"]:first-of-type', '2023-01-01');

  // Fill duties narrative (required field)
  const dutiesEditor = page.locator('.tiptap, [contenteditable="true"]').first();
  await dutiesEditor.click();
  await dutiesEditor.fill('Frequency spec test duties narrative.');

  // Fill hours triple: 5 h/wk × 4 wk = 20 h
  const hoursPerWeekInput = page.getByLabel('Hours/Week', { exact: false });
  await hoursPerWeekInput.fill('5');
  const numberOfWeeksInput = page.getByLabel('Weeks', { exact: false });
  await numberOfWeeksInput.fill('4');

  // Wait for totalHours to derive to 20
  const totalHoursInput = page.getByLabel('Total Hours', { exact: false });
  await expect(totalHoursInput).toHaveValue('20', { timeout: 3000 });
}

async function deleteExperience(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  orgName: string,
) {
  const deleteBtn = page
    .locator('[data-testid="experience-row"]')
    .filter({ hasText: orgName })
    .getByRole('button', { name: /^Delete$/i });
  await deleteBtn.click();

  await expect(
    page.locator('[data-testid="experience-row"]').filter({ hasText: orgName }),
  ).toHaveCount(0, { timeout: 5000 });
}

test.describe('Frequency enum, end-date field, and isCurrent toggle paths', () => {
  test('Scenario 1 — each frequency value round-trips through create and edit-form re-open', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    for (const frequencyValue of ['temporary', 'recurring', 'ongoing'] as const) {
      const orgName = `Freq-${frequencyValue}-${Date.now()}`;

      // Open create form
      await openCreateForm(page);

      // Fill required fields
      await fillRequiredFields(page, orgName);

      // Select frequency value
      await page.selectOption('select', frequencyValue);

      // Submit
      await page.click('button[type="submit"]:not([disabled])');

      // Wait for modal to close
      await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
        timeout: 10000,
      });

      // Assert the experience row is visible
      await expect(
        page.locator('[data-testid="experience-row"]').filter({ hasText: orgName }),
      ).toBeVisible({ timeout: 5000 });

      // Open the edit form (re-open) to verify frequency round-trips
      const row = page.locator('[data-testid="experience-row"]').filter({ hasText: orgName });
      await row.getByRole('button', { name: /^Edit$/i }).click();

      // Assert the frequency select shows the saved value
      await expect(page.locator('select')).toHaveValue(frequencyValue, { timeout: 5000 });

      // Cancel the edit form
      await page.getByRole('button', { name: /^Cancel$/i }).click();

      // Wait for modal to close
      await expect(page.getByRole('heading', { name: /Edit Experience/i })).not.toBeVisible({
        timeout: 5000,
      });

      // Delete the experience
      await deleteExperience(page, orgName);
    }
  });

  test('Scenario 2 — isCurrent=true shows "Ongoing" in End Date cell', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    const orgName = `isCurrent-true-${Date.now()}`;

    // Open create form
    await openCreateForm(page);

    // Fill required fields
    await fillRequiredFields(page, orgName);

    // Check "Currently active" checkbox — do NOT set endDate
    await page.getByLabel('Currently active').check();

    // Submit
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // Assert the End Date cell displays "Ongoing"
    const row = page.locator('[data-testid="experience-row"]').filter({ hasText: orgName });
    await expect(row).toBeVisible({ timeout: 5000 });

    // The End Date column (7th cell, index 6) should contain "Ongoing"
    const endDateCell = row.locator('td').nth(6);
    await expect(endDateCell).toHaveText('Ongoing', { timeout: 5000 });

    // Delete
    await deleteExperience(page, orgName);
  });

  test('Scenario 3 — isCurrent=false + endDate shows the date in End Date cell', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    const orgName = `isCurrent-false-${Date.now()}`;

    // Open create form
    await openCreateForm(page);

    // Fill required fields (isCurrent checkbox defaults to unchecked)
    await fillRequiredFields(page, orgName);

    // Ensure isCurrent is unchecked
    await page.getByLabel('Currently active').uncheck();

    // Set endDate to 2024-06-01 — the second date input is the End Date field
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(1).fill('2024-06-01');

    // Submit
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // Assert the End Date cell displays the date
    const row = page.locator('[data-testid="experience-row"]').filter({ hasText: orgName });
    await expect(row).toBeVisible({ timeout: 5000 });

    const endDateCell = row.locator('td').nth(6);
    await expect(endDateCell).toHaveText('2024-06-01', { timeout: 5000 });

    // Delete
    await deleteExperience(page, orgName);
  });
});
