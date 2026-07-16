// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6050)
//   UI:  pnpm --filter @asp/ui dev   (port 6051)
// Pre-requisite: DATABASE_URL must point to a running Postgres instance.
// Not included in CI — intended for local pre-merge runs.
//
// This spec regression-guards UI-038: admin sub-page navigation must remain
// client-side (no full-page reload). A sentinel flag written to window is used
// to detect whether a full reload occurred between nav clicks.

import { test, expect } from '@playwright/test';
import { setupAdminSession, adminSessionFile } from './fixtures/adminSession.js';

// ---------------------------------------------------------------------------
// Session setup — runs once for the whole file.
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  await setupAdminSession();
});

test.use({
  storageState: adminSessionFile,
  viewport: { width: 1280, height: 800 },
});

// ---------------------------------------------------------------------------
// Helper — asserts that a nav click changes the URL without a full-page reload.
// The sentinel (window.__navSentinel) is set once on /admin, then checked after
// every subsequent in-SPA navigation to prove no reload occurred.
// ---------------------------------------------------------------------------

type PageWithSentinel = Parameters<Parameters<typeof test>[1]>[0]['page'] & {
  evaluate<T>(fn: () => T): Promise<T>;
};

test.describe('Admin SPA navigation (UI-038 regression guard)', () => {
  test('admin nav links change route without full-page reload', async ({ page }) => {
    // ── Navigate to /admin ────────────────────────────────────────────────────
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // ── Install in-page sentinel ──────────────────────────────────────────────
    // window.__navSentinel is truthy only while the JS runtime is alive (i.e.,
    // a full reload would clear it).
    await (page as PageWithSentinel).evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__navSentinel = true;
    });

    // ── Click "Categories" nav link ───────────────────────────────────────────
    await page.getByRole('link', { name: 'Categories' }).click();
    await page.waitForURL('**/admin/categories', { timeout: 10_000 });

    expect(page.url()).toMatch(/\/admin\/categories$/);
    const sentinelAfterCategories = await (page as PageWithSentinel).evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__navSentinel as boolean | undefined,
    );
    expect(sentinelAfterCategories).toBe(true);

    // ── Click "Grants" nav link ───────────────────────────────────────────────
    await page.getByRole('link', { name: 'Grants' }).click();
    await page.waitForURL('**/admin/grants', { timeout: 10_000 });

    expect(page.url()).toMatch(/\/admin\/grants$/);
    const sentinelAfterGrants = await (page as PageWithSentinel).evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__navSentinel as boolean | undefined,
    );
    expect(sentinelAfterGrants).toBe(true);

    // ── Click "Users" nav link ────────────────────────────────────────────────
    await page.getByRole('link', { name: 'Users' }).click();
    await page.waitForURL('**/admin/users', { timeout: 10_000 });

    expect(page.url()).toMatch(/\/admin\/users$/);
    const sentinelAfterUsers = await (page as PageWithSentinel).evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__navSentinel as boolean | undefined,
    );
    expect(sentinelAfterUsers).toBe(true);
  });
});
