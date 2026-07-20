// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6080)
//   UI:  pnpm --filter @asp/ui dev   (port 6081)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.
//
// These three scenarios exercise client-side Zod validation (via react-hook-form).
// Errors appear inline before the form submits to the API — no server round-trip occurs.

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

/**
 * Fill the minimum required fields that are NOT the focus of the current test.
 * Sets a valid hours triple (5 h/wk × 4 wk = 20 h total).
 */
async function fillMinimumRequiredFields(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  orgName: string,
  dutiesText: string,
) {
  await page.fill('input[placeholder="Organization name"]', orgName);
  await page.fill('input[placeholder="Your role or title"]', 'Tester');
  await page.fill('input[type="date"]:first-of-type', '2022-06-01');

  // Duties narrative
  const dutiesEditor = page.locator('.tiptap, [contenteditable="true"]').first();
  await dutiesEditor.click();
  await dutiesEditor.fill(dutiesText);

  // Hours triple: 5 h/wk × 4 wk = 20 h
  const hoursPerWeekInput = page.getByLabel('Hours/Week', { exact: false });
  await hoursPerWeekInput.fill('5');
  const numberOfWeeksInput = page.getByLabel('Weeks', { exact: false });
  await numberOfWeeksInput.fill('4');

  // Wait for totalHours to derive to 20
  const totalHoursInput = page.getByLabel('Total Hours', { exact: false });
  await expect(totalHoursInput).toHaveValue('20', { timeout: 3000 });
}

test.describe('Validation-error rendering — client-side Zod (TEST-021)', () => {
  test('Scenario 1 — over-length organization (>256 chars) shows inline error, no navigation', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);
    const initialUrl = `/experiences/${firstCategory.slug}`;

    await page.goto(initialUrl);
    await page.waitForURL(`**${initialUrl}`);

    await openCreateForm(page);

    // Use an over-length org name (257 chars) as the offending value.
    // Fill other required fields with valid data.
    const overLengthOrg = 'a'.repeat(257);
    await fillMinimumRequiredFields(page, overLengthOrg, 'Validation scenario 1 narrative.');

    // Submit
    await page.click('button[type="submit"]:not([disabled])');

    // Inline error for organization field must appear
    const orgError = page.locator('p.text-danger-700').filter({ hasText: /.+/ }).first();
    await expect(orgError).toBeVisible({ timeout: 5000 });

    // URL must not have changed (no navigation)
    expect(page.url()).toContain(initialUrl);
  });

  test('Scenario 2 — invalid contactPhone (not E.164) shows inline error, no navigation', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);
    const initialUrl = `/experiences/${firstCategory.slug}`;

    await page.goto(initialUrl);
    await page.waitForURL(`**${initialUrl}`);

    await openCreateForm(page);

    // Fill required fields with valid data; phone is the offending field.
    await fillMinimumRequiredFields(page, 'Phone Validation Org', 'Validation scenario 2 narrative.');

    // Bad phone: replace last digit with 'X' → not E.164
    const badPhone = '+15551234567'.replace(/\d$/, 'X');
    await page.fill('input[placeholder="+1234567890"]', badPhone);

    // Submit
    await page.click('button[type="submit"]:not([disabled])');

    // Inline error for contactPhone must appear
    const phoneError = page
      .locator('p.text-danger-700')
      .filter({ hasText: /.+/ });
    await expect(phoneError.first()).toBeVisible({ timeout: 5000 });

    // URL must not have changed
    expect(page.url()).toContain(initialUrl);
  });

  test('Scenario 3 — over-length dutiesNarrative (>8192 chars) disables submit, no navigation', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);
    const initialUrl = `/experiences/${firstCategory.slug}`;

    await page.goto(initialUrl);
    await page.waitForURL(`**${initialUrl}`);

    await openCreateForm(page);

    // Fill org, position, start date and hours triple with valid values.
    // dutiesNarrative is the offending field.
    await page.fill('input[placeholder="Organization name"]', 'Duties Length Org');
    await page.fill('input[placeholder="Your role or title"]', 'Tester');
    await page.fill('input[type="date"]:first-of-type', '2022-06-01');

    // Over-length narrative (8193 chars)
    const overLengthNarrative = 'x'.repeat(8193);
    const dutiesEditor = page.locator('.tiptap, [contenteditable="true"]').first();
    await dutiesEditor.click();
    await dutiesEditor.fill(overLengthNarrative);

    // Hours triple
    const hoursPerWeekInput = page.getByLabel('Hours/Week', { exact: false });
    await hoursPerWeekInput.fill('5');
    const numberOfWeeksInput = page.getByLabel('Weeks', { exact: false });
    await numberOfWeeksInput.fill('4');
    const totalHoursInput = page.getByLabel('Total Hours', { exact: false });
    await expect(totalHoursInput).toHaveValue('20', { timeout: 3000 });

    // ExperienceForm disables the submit button when dutiesValue.length > 8192.
    // Assert the button is disabled — no submission can occur.
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled({ timeout: 3000 });

    // URL must not have changed
    expect(page.url()).toContain(initialUrl);
  });
});
