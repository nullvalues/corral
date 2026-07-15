// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6040)
//   UI:  pnpm --filter @asp/ui dev   (port 6041)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.
//
// This spec verifies:
//   1. A mentor with an active grant can view an applicant's experiences in the UI.
//   2. A pii_access_log row with viaGrant: true is written for each such list access.

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import { setupAdminSession } from './fixtures/adminSession.js';
import { setupMentorSession, mentorSessionFile } from './fixtures/mentorSession.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';

// ---------------------------------------------------------------------------
// Shared state — populated in beforeAll, consumed in the test body.
// ---------------------------------------------------------------------------

let applicantUserId = '';
let mentorUserId = '';
let experienceId = '';
let countBefore = 0;

let adminCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let applicantCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

// ---------------------------------------------------------------------------
// beforeAll — provision users, grant, and one experience
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  // 1. Provision sessions (all three users)
  await setupApplicantSession();
  await setupAdminSession();
  const mentor = await setupMentorSession();
  mentorUserId = mentor.userId;

  // 2. Build API contexts using the saved storage states
  applicantCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });

  adminCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    // Admin session state path — import the file path from the fixture
    storageState: (await import('./fixtures/adminSession.js')).adminSessionFile,
  });

  // 3. Resolve applicant userId from /api/me
  const meRes = await applicantCtx.get(`${API_BASE}/api/me`);
  expect(meRes.ok()).toBeTruthy();
  const meBody = (await meRes.json()) as { user: { id: string } };
  applicantUserId = meBody.user.id;

  // 4. Admin creates a mentor grant
  const grantRes = await adminCtx.post(`${API_BASE}/api/mentor-grants`, {
    data: { mentorUserId, applicantUserId, permissions: ['read'] },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(grantRes.status()).toBe(201);

  // 5. Applicant creates one experience to ensure the mentor page has content
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
      organization: 'Mentor-read test org',
      position: 'Test position',
      frequency: 'ongoing',
      startDate: '2024-01-01',
      dutiesNarrative: 'Testing PII log write via mentor read.',
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

  // 6. Record the baseline pii log count for this mentor before the UI visit
  const logRes = await adminCtx.get(
    `${API_BASE}/api/admin/pii-log?mentorUserId=${encodeURIComponent(mentorUserId)}`,
  );
  expect(logRes.ok()).toBeTruthy();
  const rows = (await logRes.json()) as unknown[];
  countBefore = rows.length;
});

// ---------------------------------------------------------------------------
// afterAll — clean up the experience created in beforeAll
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  if (experienceId && applicantCtx) {
    await applicantCtx.delete(`${API_BASE}/api/experiences/${experienceId}`);
  }
  await applicantCtx?.dispose();
  await adminCtx?.dispose();
});

// ---------------------------------------------------------------------------
// Test — mentor navigates to applicant's experiences; audit log row appears
// ---------------------------------------------------------------------------

test('mentor with active grant can view applicant experiences; pii_access_log row written', async ({
  browser,
}) => {
  // Use the mentor's stored session to open a browser page
  const mentorBrowserCtx = await browser.newContext({ storageState: mentorSessionFile });
  const page = await mentorBrowserCtx.newPage();

  try {
    // 1. Navigate to the mentor experiences view for this applicant
    await page.goto(`/mentor/${applicantUserId}/experiences`);

    // 2. Wait until at least one experience row is visible
    //    The page renders experience cards or table rows — wait for the org name
    await page.waitForSelector(`text=Mentor-read test org`, { timeout: 15_000 });

    // 3. Check that the pii log now has one more row than before
    const logRes = await adminCtx.get(
      `${API_BASE}/api/admin/pii-log?mentorUserId=${encodeURIComponent(mentorUserId)}`,
    );
    expect(logRes.ok()).toBeTruthy();
    const rows = (await logRes.json()) as Array<{
      id: string;
      actorUserId: string;
      viaGrant: boolean;
      subjectUserId: string | null;
    }>;
    expect(rows.length).toBe(countBefore + 1);

    // 4. The newest row must have viaGrant === true
    const newest = rows[0]; // ordered createdAt DESC
    expect(newest.viaGrant).toBe(true);
    expect(newest.actorUserId).toBe(mentorUserId);
    expect(newest.subjectUserId).toBe(applicantUserId);
  } finally {
    await mentorBrowserCtx.close();
  }
});
