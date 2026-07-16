// E2E tests require live dev servers (or the production container in CI):
//   API: pnpm --filter @asp/api dev  (port 6050)
//   UI:  pnpm --filter @asp/ui dev   (port 6051)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI gate — intended for local pre-merge runs.
//
// This spec verifies the verification flow (TEST-043):
//   1. A mentor with a write grant opens an applicant's experience flyout,
//      sees the identity header (CER-018 regression guard) and an "Unverified"
//      badge, then clicks "Verify experience" and sees the "✓ Verified" badge.
//   2. The applicant opens the same experience flyout and sees a read-only
//      "✓ Verified" badge with no "Verify experience" button.

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import { setupAdminSession } from './fixtures/adminSession.js';
import { setupMentorSession, mentorSessionFile } from './fixtures/mentorSession.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// ---------------------------------------------------------------------------
// Shared state — populated in beforeAll, consumed in the test bodies.
// ---------------------------------------------------------------------------

let applicantUserId = '';
let mentorUserId = '';
let experienceId = '';

let adminCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let applicantCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

// ---------------------------------------------------------------------------
// beforeAll — provision users, write grant, and one experience.
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  // 1. Provision sessions (all three users)
  await setupApplicantSession();
  await setupAdminSession();
  const mentor = await setupMentorSession();
  mentorUserId = mentor.userId;

  // API-037: denyRole('applicant') removed — the mentor retains its default
  // 'applicant' system role. The write grant is the entitlement for verification.

  // 3. Build API contexts using the saved storage states
  applicantCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });

  adminCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: (await import('./fixtures/adminSession.js')).adminSessionFile,
  });

  // 4. Resolve applicant userId from /api/me
  const meRes = await applicantCtx.get(`${API_BASE}/api/me`);
  expect(meRes.ok()).toBeTruthy();
  const meBody = (await meRes.json()) as { user: { id: string } };
  applicantUserId = meBody.user.id;

  // 5. Admin creates a write grant (write is required to verify per ADR-035)
  const grantRes = await adminCtx.post(`${API_BASE}/api/mentor-grants`, {
    data: { mentorUserId, applicantUserId, permissions: ['write'] },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(grantRes.status()).toBe(201);

  // 6. Applicant creates one experience in the first active category.
  const catRes = await applicantCtx.get(`${API_BASE}/api/experience-categories`);
  expect(catRes.ok()).toBeTruthy();
  const categories = (await catRes.json()) as Array<{
    id: string;
    isActive: boolean;
    sortOrder: number;
  }>;
  const active = categories.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  expect(active.length).toBeGreaterThan(0);
  const categoryId = active[0].id;

  const expRes = await applicantCtx.post(`${API_BASE}/api/experiences`, {
    data: {
      categoryId,
      organization: 'Verify-flow test org',
      position: 'Test position',
      frequency: 'ongoing',
      startDate: '2024-01-01',
      dutiesNarrative: 'Testing mentor verification flow end to end.',
      totalHours: 40,
      hoursPerWeek: 40,
      numberOfWeeks: 1,
      isCurrent: true,
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
// afterAll — clean up the experience created in beforeAll.
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  if (experienceId && applicantCtx) {
    await applicantCtx.delete(`${API_BASE}/api/experiences/${experienceId}`);
  }
  await applicantCtx?.dispose();
  await adminCtx?.dispose();
});

// ---------------------------------------------------------------------------
// Test 1 — mentor verifies the experience from the flyout.
// ---------------------------------------------------------------------------

test('mentor verifies an experience from the flyout', async ({ browser }) => {
  const mentorBrowserCtx = await browser.newContext({ storageState: mentorSessionFile });
  const page = await mentorBrowserCtx.newPage();

  try {
    // Navigate to the mentor-scoped experiences view; it redirects to the
    // first active category, which is where the seeded experience lives.
    await page.goto(`/mentor/${applicantUserId}/experiences`);

    // Wait until the experience row is visible, then open its flyout.
    await page.waitForSelector('text=Verify-flow test org', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Details' }).first().click();

    // CER-018 regression guard: the identity header (org name) is visible in the flyout.
    const flyout = page.locator('text=Experience Details').locator('..').locator('..');
    await expect(flyout.getByText('Verify-flow test org')).toBeVisible({ timeout: 10_000 });

    // The verification badge starts as "Unverified".
    const badge = page.getByTestId('verification-badge');
    await expect(badge).toHaveText('Unverified', { timeout: 10_000 });

    // Click "Verify experience".
    await page.getByRole('button', { name: 'Verify experience' }).click();

    // The badge updates to "✓ Verified".
    await expect(badge).toHaveText('✓ Verified', { timeout: 10_000 });
  } finally {
    await mentorBrowserCtx.close();
  }
});

// ---------------------------------------------------------------------------
// Test 2 — applicant sees the read-only verified badge, no verify button.
// ---------------------------------------------------------------------------

test('applicant sees the read-only verified badge with no verify control', async ({ browser }) => {
  const applicantBrowserCtx = await browser.newContext({ storageState: applicantSessionFile });
  const page = await applicantBrowserCtx.newPage();

  try {
    await page.goto('/experiences');

    await page.waitForSelector('text=Verify-flow test org', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Details' }).first().click();

    // The badge reads "✓ Verified" in the applicant's read-only view.
    const badge = page.getByTestId('verification-badge');
    await expect(badge).toHaveText('✓ Verified', { timeout: 10_000 });

    // No mentor controls are present for the applicant.
    await expect(page.getByRole('button', { name: 'Verify experience' })).toHaveCount(0);
  } finally {
    await applicantBrowserCtx.close();
  }
});
