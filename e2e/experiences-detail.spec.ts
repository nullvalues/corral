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
  await dutiesEditor.fill('Detail flyout round-trip test duties narrative.');

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

test.describe('ExperienceDetailFlyout — open/render/close round-trip', () => {
  test('Scenario 1 — flyout opens, renders heading + sections + attestation, and closes', async ({
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
    const orgName = `Detail Flyout Org ${Date.now()}`;
    await fillRequiredFields(page, orgName);

    // ── Fill location ─────────────────────────────────────────────────────────
    await page.fill('input[placeholder="State / Province"]', 'California');

    // ── Check isVolunteer attestation ─────────────────────────────────────────
    await page.getByLabel('Volunteer').check();

    // ── Submit the form ───────────────────────────────────────────────────────
    await page.click('button[type="submit"]:not([disabled])');

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: /Add Experience/i })).not.toBeVisible({
      timeout: 10000,
    });

    // ── Assert the new experience appears in the table ────────────────────────
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 5000 });

    // ── Open the detail flyout ────────────────────────────────────────────────
    const row = page.locator('[data-testid="experience-row"]').filter({ hasText: orgName });
    await row.getByRole('button', { name: /^Details$/i }).click();

    // ── Assert flyout heading is visible ─────────────────────────────────────
    await expect(page.getByRole('heading', { name: /Experience Details/i })).toBeVisible({
      timeout: 5000,
    });

    // ── Scope section assertions to the flyout container ─────────────────────
    const flyout = page.locator('.fixed.inset-y-0.right-0');

    // Location section heading
    await expect(flyout.getByRole('heading', { name: /location/i })).toBeVisible();

    // Attestations section heading
    await expect(flyout.getByRole('heading', { name: /attestations/i })).toBeVisible();

    // Contact section heading
    await expect(flyout.getByRole('heading', { name: /contact/i })).toBeVisible();

    // Attestation: Volunteer = Yes
    const volunteerRow = flyout.locator('dt', { hasText: 'Volunteer' }).locator('..');
    await expect(volunteerRow.locator('dd')).toHaveText('Yes');

    // Location: California visible
    await expect(flyout.getByText('California')).toBeVisible();

    // ── Close flyout via aria-label="Close" button ────────────────────────────
    await page.getByRole('button', { name: /Close/i }).click();

    // ── Assert flyout is no longer visible ────────────────────────────────────
    await expect(page.getByRole('heading', { name: /Experience Details/i })).not.toBeVisible({
      timeout: 5000,
    });

    // ── Clean up: delete the experience ──────────────────────────────────────
    await deleteExperience(page, orgName);
  });

  test('Scenario 2 — contact fields (email + phone) visible in flyout when permissionToContact is true', async ({
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
    const orgName = `Contact Fields Flyout Org ${Date.now()}`;
    await fillRequiredFields(page, orgName);

    // ── Fill contact PII fields ───────────────────────────────────────────────
    await page.fill('input[placeholder="Contact email"]', 'mentor@test.com');
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
    const row = page.locator('[data-testid="experience-row"]').filter({ hasText: orgName });
    await row.getByRole('button', { name: /^Details$/i }).click();

    // Wait for flyout to appear
    await expect(page.getByRole('heading', { name: /Experience Details/i })).toBeVisible({
      timeout: 5000,
    });

    // ── Assert Contact section shows email and phone ──────────────────────────
    const flyout = page.locator('.fixed.inset-y-0.right-0');
    await expect(flyout.getByText('mentor@test.com')).toBeVisible();
    await expect(flyout.getByText('+15551234567')).toBeVisible();

    // ── Close flyout ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Close/i }).click();

    // ── Clean up: delete the experience ──────────────────────────────────────
    await deleteExperience(page, orgName);
  });
});
