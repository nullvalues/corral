// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev   (port 6050)
//   UI:  pnpm --filter @asp/ui dev    (port 6051)
//   Seed: pnpm --filter @asp/api db:seed
//   Run:  npx playwright test e2e/mentor-recruiting-flow.spec.ts
//
// This spec verifies the full mentor recruiting journey:
//   B1 — Talent pool: granted applicant appears; ungrant applicant does not.
//   B2 — Review → shortlist → rate: UI reflects change optimistically; API confirms.
//   B3 — Isolation: a second mentor's shortlist state for the same applicant is independent.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import { generateSync } from 'otplib';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import { setupAdminSession, adminSessionFile } from './fixtures/adminSession.js';
import { setupMentorSession, mentorSessionFile } from './fixtures/mentorSession.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// ---------------------------------------------------------------------------
// Shared state — populated in beforeAll, consumed in test bodies.
// ---------------------------------------------------------------------------

let applicantUserId = '';
let mentorUserId = '';
let mentor2UserId = '';
let exp1Id = '';
let exp2Id = '';

let adminCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let applicantCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let mentorCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let mentor2Ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

// ---------------------------------------------------------------------------
// Helper — create a fresh mentor account via API only (no browser session
// needed for the isolation test).  Returns an authenticated request context
// and the user's id.
// ---------------------------------------------------------------------------

async function createMentorApiSession(): Promise<{
  ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
  userId: string;
}> {
  const email = `mentor2+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });

  const signUpRes = await ctx.post(`${API_BASE}/api/auth/sign-up`, {
    data: { email, password, name: email },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!signUpRes.ok()) {
    throw new Error(`Mentor2 sign-up failed: ${signUpRes.status()} ${await signUpRes.text()}`);
  }

  const enableRes = await ctx.post(`${API_BASE}/api/auth/two-factor/enable`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  if (!enableRes.ok()) {
    throw new Error(
      `Mentor2 TOTP enable failed: ${enableRes.status()} ${await enableRes.text()}`,
    );
  }
  const { totpURI } = (await enableRes.json()) as { totpURI: string };

  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error('No TOTP secret for mentor2');
  const code = generateSync({ secret });

  const verifyRes = await ctx.post(`${API_BASE}/api/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!verifyRes.ok()) {
    throw new Error(
      `Mentor2 TOTP verify failed: ${verifyRes.status()} ${await verifyRes.text()}`,
    );
  }

  const meRes = await ctx.get(`${API_BASE}/api/me`);
  if (!meRes.ok()) {
    throw new Error(`Mentor2 GET /api/me failed: ${meRes.status()}`);
  }
  const meBody = (await meRes.json()) as { user: { id: string } };

  return { ctx, userId: meBody.user.id };
}

// ---------------------------------------------------------------------------
// beforeAll — provision users, grant, and experiences
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  // 1. Provision sessions for applicant, admin, and mentor1 (writes mentorSessionFile).
  await setupApplicantSession();
  await setupAdminSession();
  const mentor = await setupMentorSession();
  mentorUserId = mentor.userId;

  // 2. Build API request contexts from saved storage states.
  applicantCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: applicantSessionFile,
  });
  adminCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: adminSessionFile,
  });
  mentorCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: mentorSessionFile,
  });

  // 3. Resolve applicant userId via GET /api/me.
  const meRes = await applicantCtx.get(`${API_BASE}/api/me`);
  expect(meRes.ok()).toBeTruthy();
  const meBody = (await meRes.json()) as { user: { id: string } };
  applicantUserId = meBody.user.id;

  // 4. Fetch active categories; ensure at least 2 so experiences span distinct categories.
  const catRes = await applicantCtx.get(`${API_BASE}/api/experience-categories`);
  expect(catRes.ok()).toBeTruthy();
  const categories = (await catRes.json()) as Array<{
    id: string;
    isActive: boolean;
    sortOrder: number;
  }>;
  const active = categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  expect(active.length).toBeGreaterThanOrEqual(2);

  // 5. Seed two experiences for the applicant across two distinct active categories.
  const exp1Res = await applicantCtx.post(`${API_BASE}/api/experiences`, {
    data: {
      categoryId: active[0].id,
      organization: 'Recruiting Flow Org A',
      position: 'Role A',
      frequency: 'ongoing',
      startDate: '2024-01-01',
      dutiesNarrative: 'Experience A for the mentor recruiting-flow UAT spec.',
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
  expect(exp1Res.status()).toBe(201);
  exp1Id = ((await exp1Res.json()) as { id: string }).id;

  const exp2Res = await applicantCtx.post(`${API_BASE}/api/experiences`, {
    data: {
      categoryId: active[1].id,
      organization: 'Recruiting Flow Org B',
      position: 'Role B',
      frequency: 'recurring',
      startDate: '2023-06-01',
      endDate: '2023-12-31',
      dutiesNarrative: 'Experience B for the mentor recruiting-flow UAT spec.',
      totalHours: 20,
      hoursPerWeek: 5,
      numberOfWeeks: 4,
      isCurrent: false,
      receivedAcademicCredit: true,
      receivedSalaryOrPayment: false,
      isVolunteer: false,
      isMostImportant: false,
      permissionToContact: false,
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(exp2Res.status()).toBe(201);
  exp2Id = ((await exp2Res.json()) as { id: string }).id;

  // 6. Admin grants mentor1 an active read+write grant over the applicant.
  const grant1Res = await adminCtx.post(`${API_BASE}/api/mentor-grants`, {
    data: {
      mentorUserId,
      applicantUserId,
      permissions: ['read', 'write'],
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(grant1Res.status()).toBe(201);

  // 7. Create mentor2 via API (no UI session needed) and grant them access too.
  const mentor2 = await createMentorApiSession();
  mentor2UserId = mentor2.userId;
  mentor2Ctx = mentor2.ctx;

  const grant2Res = await adminCtx.post(`${API_BASE}/api/mentor-grants`, {
    data: {
      mentorUserId: mentor2UserId,
      applicantUserId,
      permissions: ['read', 'write'],
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(grant2Res.status()).toBe(201);
});

// ---------------------------------------------------------------------------
// afterAll — clean up the experiences created in beforeAll
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  if (exp1Id && applicantCtx) {
    await applicantCtx.delete(`${API_BASE}/api/experiences/${exp1Id}`);
  }
  if (exp2Id && applicantCtx) {
    await applicantCtx.delete(`${API_BASE}/api/experiences/${exp2Id}`);
  }
  await applicantCtx?.dispose();
  await adminCtx?.dispose();
  await mentorCtx?.dispose();
  await mentor2Ctx?.dispose();
});

// ---------------------------------------------------------------------------
// B1 — Talent pool visibility
// ---------------------------------------------------------------------------

test('B1: granted applicant appears in talent pool; pool is grant-scoped', async ({
  browser,
}) => {
  const mentorBrowserCtx = await browser.newContext({ storageState: mentorSessionFile });
  const page = await mentorBrowserCtx.newPage();

  try {
    // Navigate to the full talent pool page.
    await page.goto('/mentor/talent-pool');

    // Wait until at least one ranked entry is visible (the granted applicant).
    await page.waitForSelector('[data-testid="talent-pool-rank-1"]', { timeout: 20_000 });

    // Confirm via API: the granted applicant is present.
    const tpRes = await mentorCtx.get(`${API_BASE}/api/mentor/talent-pool`);
    expect(tpRes.ok()).toBeTruthy();
    const entries = (await tpRes.json()) as Array<{ applicantUserId: string }>;

    expect(entries.some((e) => e.applicantUserId === applicantUserId)).toBe(true);

    // Because mentor1 is freshly provisioned with exactly one grant, every
    // entry in the pool belongs to the granted applicant — proving that
    // applicants without a grant do not appear.
    expect(entries.every((e) => e.applicantUserId === applicantUserId)).toBe(true);
  } finally {
    await mentorBrowserCtx.close();
  }
});

// ---------------------------------------------------------------------------
// B2 — Review → shortlist → rate
// ---------------------------------------------------------------------------

test('B2: mentor shortlists and rates applicant; UI reflects optimistically; API confirms', async ({
  browser,
}) => {
  const mentorBrowserCtx = await browser.newContext({ storageState: mentorSessionFile });
  const page = await mentorBrowserCtx.newPage();

  try {
    // Navigate to the applicant review screen (index route under MentorScopeLayout).
    await page.goto(`/mentor/${applicantUserId}`);

    // Wait for the ShortlistControl to mount (MentorScopeLayout resolves the grant first).
    await page.waitForSelector('[data-testid="shortlist-control"]', { timeout: 20_000 });

    // ── Step 1: rate 4 stars ────────────────────────────────────────────────
    const ratePatchPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/mentor/applicants/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: 'Rate 4 stars' }).click();
    await ratePatchPromise;

    // Allow onSettled invalidation + talent-pool refetch to complete.
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/mentor/talent-pool') && r.request().method() === 'GET',
      { timeout: 10_000 },
    );

    // ── Step 2: shortlist ───────────────────────────────────────────────────
    const shortlistBtn = page.getByRole('button', { name: 'Shortlist for interview' });

    const shortlistPatchPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/mentor/applicants/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await shortlistBtn.click();

    // Optimistic update: aria-pressed flips to true immediately (before API returns).
    await expect(shortlistBtn).toHaveAttribute('aria-pressed', 'true');

    // Wait for the mutation to settle.
    await shortlistPatchPromise;

    // Allow talentPool invalidation + refetch to complete.
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/mentor/talent-pool') && r.request().method() === 'GET',
      { timeout: 10_000 },
    );

    // ── API confirmation ────────────────────────────────────────────────────
    const tpRes = await mentorCtx.get(`${API_BASE}/api/mentor/talent-pool`);
    expect(tpRes.ok()).toBeTruthy();
    const entries = (await tpRes.json()) as Array<{
      applicantUserId: string;
      shortlisted: boolean;
      starRating: number | null;
    }>;
    const entry = entries.find((e) => e.applicantUserId === applicantUserId);
    expect(entry).toBeDefined();
    expect(entry!.shortlisted).toBe(true);
    expect(entry!.starRating).toBe(4);
  } finally {
    await mentorBrowserCtx.close();
  }
});

// ---------------------------------------------------------------------------
// B3 — Isolation: mentor2 sees their own (default) state for the same applicant
// ---------------------------------------------------------------------------

test('B3: second mentor sees their own independent shortlist state for the same applicant', async () => {
  // mentor2 has not set any shortlist / rating.  Their talent-pool entry for the
  // applicant must show the default state, regardless of mentor1's changes in B2.
  const tpRes = await mentor2Ctx.get(`${API_BASE}/api/mentor/talent-pool`);
  expect(tpRes.ok()).toBeTruthy();
  const entries = (await tpRes.json()) as Array<{
    applicantUserId: string;
    shortlisted: boolean;
    starRating: number | null;
  }>;

  const entry = entries.find((e) => e.applicantUserId === applicantUserId);
  expect(entry).toBeDefined();

  // mentor2 never shortlisted or rated — must reflect the default (unset) state.
  expect(entry!.shortlisted).toBe(false);
  expect(entry!.starRating).toBeNull();
});
