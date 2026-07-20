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

test.describe('Hours triple — valid values and constraint violation', () => {
  test('Scenario 1 — valid triple (10 h/wk × 12 wk = 120 h) saves and reads back', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);

    // ── Navigate to the experiences page ─────────────────────────────────────
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    // ── Open the create form ──────────────────────────────────────────────────
    await openCreateForm(page);

    // ── Fill in required fields ───────────────────────────────────────────────
    const orgName = `Hours Test Org ${Date.now()}`;
    await page.fill('input[placeholder="Organization name"]', orgName);
    await page.fill('input[placeholder="Your role or title"]', 'Researcher');
    await page.fill('input[type="date"]:first-of-type', '2023-01-01');

    // Fill duties narrative (required field)
    const dutiesEditor = page.locator('.tiptap, [contenteditable="true"]').first();
    await dutiesEditor.click();
    await dutiesEditor.fill('Test duties narrative for hours triple test.');

    // ── Set hours triple: hoursPerWeek=10, numberOfWeeks=12 → totalHours auto-derives to 120 ──
    // Fill hoursPerWeek first (label "Hours/Week")
    const hoursPerWeekInput = page.getByLabel('Hours/Week', { exact: false });
    await hoursPerWeekInput.fill('10');

    // Fill numberOfWeeks (label "Weeks")
    const numberOfWeeksInput = page.getByLabel('Weeks', { exact: false });
    await numberOfWeeksInput.fill('12');

    // After filling hoursPerWeek + numberOfWeeks, HoursTriple derives totalHours=120.
    // Verify the totalHours field now shows 120.
    const totalHoursInput = page.getByLabel('Total Hours', { exact: false });
    await expect(totalHoursInput).toHaveValue('120', { timeout: 3000 });

    // ── Submit the form ───────────────────────────────────────────────────────
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // ── Assert the new experience appears in the table ────────────────────────
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 5000 });

    // Assert the rollup total reflects the 120 hours
    const rollupText = await page.locator('tfoot td').textContent();
    expect(rollupText).toMatch(/Total hours: \d+/);
    const totalHoursRollup = parseInt(rollupText?.match(/Total hours: (\d+)/)?.[1] ?? '0', 10);
    expect(totalHoursRollup).toBeGreaterThanOrEqual(120);

    // ── Clean up: delete the experience ──────────────────────────────────────
    const deleteBtn = page
      .locator('[data-testid="experience-row"]')
      .filter({ hasText: orgName })
      .getByRole('button', { name: /^Delete$/i });
    await deleteBtn.click();

    await expect(
      page.locator('[data-testid="experience-row"]').filter({ hasText: orgName }),
    ).toHaveCount(0, { timeout: 5000 });
  });

  test('Scenario 2 — constraint violation (10 × 12 ≠ 99) shows inline error, no navigation', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);

    // ── Navigate to the experiences page ─────────────────────────────────────
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);
    const urlBefore = page.url();

    // ── Open the create form ──────────────────────────────────────────────────
    await openCreateForm(page);

    // ── Fill in required fields ───────────────────────────────────────────────
    const orgName = `Violation Test Org ${Date.now()}`;
    await page.fill('input[placeholder="Organization name"]', orgName);
    await page.fill('input[placeholder="Your role or title"]', 'Researcher');
    await page.fill('input[type="date"]:first-of-type', '2023-01-01');

    // Fill duties narrative (required field)
    const dutiesEditor = page.locator('.tiptap, [contenteditable="true"]').first();
    await dutiesEditor.click();
    await dutiesEditor.fill('Test duties narrative for constraint violation test.');

    // ── Set an inconsistent hours triple ─────────────────────────────────────
    // Fill hoursPerWeek=10 and numberOfWeeks=12 first — HoursTriple will
    // derive totalHours=120 automatically.
    const hoursPerWeekInput = page.getByLabel('Hours/Week', { exact: false });
    await hoursPerWeekInput.fill('10');

    const numberOfWeeksInput = page.getByLabel('Weeks', { exact: false });
    await numberOfWeeksInput.fill('12');

    // Now override totalHours to 99, breaking the constraint.
    // After this edit: priority = [..., numberOfWeeks, totalHours],
    // derived = hoursPerWeek = 99/12 (not integer) → HoursTriple sets error on hoursPerWeek.
    // The form values are: totalHours=99, hoursPerWeek=10, numberOfWeeks=12 (10*12≠99).
    const totalHoursInput = page.getByLabel('Total Hours', { exact: false });
    await totalHoursInput.fill('99');

    // ── Submit the form ───────────────────────────────────────────────────────
    await page.click('button[type="submit"]');

    // ── Assert an inline error appears near the hours fields ──────────────────
    // The Zod superRefine fires on submit: totalHours ≠ hoursPerWeek × numberOfWeeks
    // → sets error message on the totalHours field.
    // The HoursTriple component also may have set an error on hoursPerWeek.
    // Assert that at least one hours-related error is visible.
    const hoursError = page.locator('p.text-danger-700').filter({
      hasText: /hours|weeks|satisfy/i,
    });
    await expect(hoursError.first()).toBeVisible({ timeout: 5000 });

    // ── Assert no navigation occurred ────────────────────────────────────────
    expect(page.url()).toBe(urlBefore);
  });
});
