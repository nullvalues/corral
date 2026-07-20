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
  await page.fill('input[placeholder="Your role or title"]', 'Supervisor');
  await page.fill('input[type="date"]:first-of-type', '2022-06-01');

  // Fill duties narrative (required field)
  const dutiesEditor = page.locator('.tiptap, [contenteditable="true"]').first();
  await dutiesEditor.click();
  await dutiesEditor.fill('Contact PII round-trip test duties narrative.');

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

test.describe('Contact PII fields — create/read round-trip', () => {
  test('Scenario 1 — PII round-trip: all contact fields + location + attestation save and display correctly', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);

    // ── Navigate to the experiences page ─────────────────────────────────────
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    // ── Open the create form ──────────────────────────────────────────────────
    await openCreateForm(page);

    // ── Fill required fields ──────────────────────────────────────────────────
    const orgName = `PII Round-trip Org ${Date.now()}`;
    await fillRequiredFields(page, orgName);

    // ── Fill location ─────────────────────────────────────────────────────────
    await page.fill('input[placeholder="State / Province"]', 'California');

    // ── Check isVolunteer attestation ─────────────────────────────────────────
    const volunteerCheckbox = page.locator('input[type="checkbox"]').filter({
      // Locate within the label that contains the text "Volunteer"
    });
    // Use label text to find the volunteer checkbox
    await page.getByLabel('Volunteer').check();

    // ── Fill contact PII fields ───────────────────────────────────────────────
    await page.fill('input[placeholder="First name"]', 'Jane');
    await page.fill('input[placeholder="Last name"]', 'Smith');
    await page.fill('input[placeholder="Contact title"]', 'Director');
    await page.fill('input[placeholder="Contact email"]', 'jane.smith@example.com');
    await page.fill('input[placeholder="+1234567890"]', '+15551234567');

    // ── Enable permissionToContact ────────────────────────────────────────────
    await page.getByLabel('Permission to contact').check();

    // ── Submit the form ───────────────────────────────────────────────────────
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // ── Assert the new experience appears in the table ────────────────────────
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 5000 });

    // ── Open the detail flyout ────────────────────────────────────────────────
    const detailsBtn = page
      .locator('[data-testid="experience-row"]')
      .filter({ hasText: orgName })
      .getByRole('button', { name: /^Details$/i });
    await detailsBtn.click();

    // Wait for flyout to appear
    await expect(page.getByRole('heading', { name: /Experience Details/i })).toBeVisible({
      timeout: 5000,
    });

    // ── Assert contact fields read back correctly ─────────────────────────────
    // Email
    const flyout = page.locator('.fixed.inset-y-0.right-0');
    await expect(flyout.getByText('jane.smith@example.com')).toBeVisible();

    // Phone
    await expect(flyout.getByText('+15551234567')).toBeVisible();

    // Volunteer attestation
    const volunteerRow = flyout.locator('dt', { hasText: 'Volunteer' }).locator('..');
    await expect(volunteerRow.locator('dd')).toHaveText('Yes');

    // ── Close flyout ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Close/i }).click();

    // ── Clean up: delete the experience ──────────────────────────────────────
    await deleteExperience(page, orgName);
  });

  test('Scenario 2 — PII hidden when consent off: no contact email or phone displayed', async ({
    page,
    request,
  }) => {
    const firstCategory = await getFirstActiveCategory(request);

    // ── Navigate to the experiences page ─────────────────────────────────────
    await page.goto(`/experiences/${firstCategory.slug}`);
    await page.waitForURL(`**/experiences/${firstCategory.slug}`);

    // ── Open the create form ──────────────────────────────────────────────────
    await openCreateForm(page);

    // ── Fill required fields only — do NOT fill contact fields ────────────────
    const orgName = `PII Consent-Off Org ${Date.now()}`;
    await fillRequiredFields(page, orgName);

    // Leave permissionToContact unchecked (default false)
    // Leave all contact fields empty

    // ── Submit the form ───────────────────────────────────────────────────────
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // ── Assert the new experience appears in the table ────────────────────────
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 5000 });

    // ── Open the detail flyout ────────────────────────────────────────────────
    const detailsBtn = page
      .locator('[data-testid="experience-row"]')
      .filter({ hasText: orgName })
      .getByRole('button', { name: /^Details$/i });
    await detailsBtn.click();

    // Wait for flyout to appear
    await expect(page.getByRole('heading', { name: /Experience Details/i })).toBeVisible({
      timeout: 5000,
    });

    // ── Assert no contact email or phone is displayed ─────────────────────────
    const flyout = page.locator('.fixed.inset-y-0.right-0');

    // Email field should show the dash placeholder (no actual email)
    const emailRow = flyout.locator('dt', { hasText: 'Email' }).locator('..');
    await expect(emailRow.locator('dd')).toHaveText('—');

    // Phone field should show the dash placeholder (no actual phone)
    const phoneRow = flyout.locator('dt', { hasText: 'Phone' }).locator('..');
    await expect(phoneRow.locator('dd')).toHaveText('—');

    // ── Close flyout ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Close/i }).click();

    // ── Clean up: delete the experience ──────────────────────────────────────
    await deleteExperience(page, orgName);
  });
});
