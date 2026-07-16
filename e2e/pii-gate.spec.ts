// E2E spec: PII gate — permissionToContact gates contact field visibility for mentor
//
// Tests the central ABAC invariant:
//   - Scenario 1: mentor sees '—' placeholders when permissionToContact=false
//   - Scenario 2: mentor sees actual PII after applicant sets permissionToContact=true
//
// Pre-requisites:
//   - At least one active experience category must exist (pnpm --filter @asp/api db:seed)
//   - dev servers running OR CI container mode

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import { setupAdminSession, adminSessionFile } from './fixtures/adminSession.js';
import { setupMentorSession, mentorSessionFile } from './fixtures/mentorSession.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// ── State shared across beforeAll / scenarios ─────────────────────────────────

let applicantUserId = '';
let mentorUserId = '';
let experienceId = '';
let categorySlug = '';
let organizationName = '';

// ── beforeAll: provision all three users, grant, and test experience ──────────

test.beforeAll(async () => {
  // 1. Set up applicant session and get userId
  await setupApplicantSession();

  const applicantCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });
  const applicantMeRes = await applicantCtx.get(`${API_BASE}/api/me`);
  if (!applicantMeRes.ok()) {
    throw new Error(`Applicant GET /api/me failed: ${applicantMeRes.status()} ${await applicantMeRes.text()}`);
  }
  const applicantMeBody = (await applicantMeRes.json()) as { user: { id: string } };
  applicantUserId = applicantMeBody.user.id;

  // Fetch an active category (requires auth — use applicant session)
  const catRes = await applicantCtx.get(`${API_BASE}/api/experience-categories`);
  if (!catRes.ok()) {
    throw new Error(`GET /api/experience-categories failed: ${catRes.status()} ${await catRes.text()}`);
  }
  const categories = (await catRes.json()) as Array<{
    id: string;
    slug: string;
    isActive: boolean;
    sortOrder: number;
  }>;
  const activeCategories = categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (activeCategories.length === 0) {
    throw new Error('No active experience categories found — run pnpm --filter @asp/api db:seed');
  }
  const firstCategory = activeCategories[0];
  categorySlug = firstCategory.slug;

  await applicantCtx.dispose();

  // 2. Set up admin session
  await setupAdminSession();

  // 3. Set up mentor session
  const mentorResult = await setupMentorSession();
  mentorUserId = mentorResult.userId;

  // 4. Create the mentor grant via admin API context
  const adminCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: adminSessionFile,
  });
  const grantRes = await adminCtx.post(`${API_BASE}/api/mentor-grants`, {
    data: { mentorUserId, applicantUserId, permissions: ['read'] },
    headers: { 'Content-Type': 'application/json' },
  });
  if (grantRes.status() !== 201) {
    throw new Error(`POST /api/mentor-grants failed: ${grantRes.status()} ${await grantRes.text()}`);
  }
  await adminCtx.dispose();

  // 5. Create the test experience as applicant with permissionToContact=false
  const expCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });
  organizationName = `PII Gate Test Org ${Date.now()}`;
  const expRes = await expCtx.post(`${API_BASE}/api/experiences`, {
    data: {
      categoryId: firstCategory.id,
      organization: organizationName,
      position: 'Test Position',
      startDate: '2023-01-01',
      totalHours: 40,
      hoursPerWeek: 10,
      numberOfWeeks: 4,
      dutiesNarrative: 'Test duties narrative for PII gate spec.',
      contactEmail: 'applicant@example.com',
      contactPhone: '+15551234567',
      permissionToContact: false,
    },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!expRes.ok()) {
    throw new Error(`POST /api/experiences failed: ${expRes.status()} ${await expRes.text()}`);
  }
  const expBody = (await expRes.json()) as { id: string };
  experienceId = expBody.id;
  await expCtx.dispose();
});

// ── afterAll: clean up the test experience ────────────────────────────────────

test.afterAll(async () => {
  if (!experienceId) return;
  const ctx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });
  await ctx.delete(`${API_BASE}/api/experiences/${experienceId}`);
  await ctx.dispose();
});

// ── Scenario 1: mentor sees '—' when permissionToContact=false ────────────────

test('Scenario 1 — mentor sees "—" for contact PII when permissionToContact=false', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: mentorSessionFile });
  const page = await ctx.newPage();

  // Navigate to applicant's experiences in mentor scope
  await page.goto(`/mentor/${applicantUserId}/experiences/${categorySlug}`);
  await page.waitForURL(`**/mentor/${applicantUserId}/experiences/${categorySlug}`, { timeout: 15_000 });

  // Locate the test experience row by experienceId (via data-testid) and open details
  const row = page.locator('[data-testid="experience-row"]').filter({ hasText: organizationName });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole('button', { name: /^Details$/i }).click();

  // Wait for flyout to appear
  const flyout = page.locator('.fixed.inset-y-0.right-0');
  await expect(flyout).toBeVisible({ timeout: 5_000 });

  // Assert contact Email and Phone show the null placeholder '—'
  const emailRow = flyout.locator('dt', { hasText: 'Email' }).locator('..');
  await expect(emailRow.locator('dd')).toHaveText('—');

  const phoneRow = flyout.locator('dt', { hasText: 'Phone' }).locator('..');
  await expect(phoneRow.locator('dd')).toHaveText('—');

  await ctx.close();
});

// ── Scenario 2: applicant enables consent, mentor sees actual PII ─────────────

test('Scenario 2 — mentor sees actual PII after applicant enables permissionToContact', async ({ browser }) => {
  // Applicant sets permissionToContact=true
  const applicantCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });
  const patchRes = await applicantCtx.patch(`${API_BASE}/api/experiences/${experienceId}`, {
    data: { permissionToContact: true },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(patchRes.status()).toBe(200);
  await applicantCtx.dispose();

  // Open a new browser context with mentor session
  const ctx = await browser.newContext({ storageState: mentorSessionFile });
  const page = await ctx.newPage();

  await page.goto(`/mentor/${applicantUserId}/experiences/${categorySlug}`);
  await page.waitForURL(`**/mentor/${applicantUserId}/experiences/${categorySlug}`, { timeout: 15_000 });

  const row = page.locator('[data-testid="experience-row"]').filter({ hasText: organizationName });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole('button', { name: /^Details$/i }).click();

  const flyout = page.locator('.fixed.inset-y-0.right-0');
  await expect(flyout).toBeVisible({ timeout: 5_000 });

  // Assert actual PII values are shown
  const emailRow = flyout.locator('dt', { hasText: 'Email' }).locator('..');
  await expect(emailRow.locator('dd')).toHaveText('applicant@example.com');

  const phoneRow = flyout.locator('dt', { hasText: 'Phone' }).locator('..');
  await expect(phoneRow.locator('dd')).toHaveText('+15551234567');

  await ctx.close();
});
