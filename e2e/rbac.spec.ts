// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6050)
//   UI:  pnpm --filter @asp/ui dev   (port 6051)
// Pre-requisite: pnpm --filter @asp/api db:seed (creates active categories)
// Not included in CI — intended for local pre-merge runs.

import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import * as fs from 'fs';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

// Set up the applicant session before all tests in this file (once).
test.beforeAll(async () => {
  if (!fs.existsSync(applicantSessionFile)) {
    await setupApplicantSession();
  }
});

// All UI tests in this file use the stored applicant session.
test.use({
  storageState: applicantSessionFile,
  viewport: { width: 1280, height: 800 },
});

test.describe('RBAC — applicant cannot access admin routes', () => {
  test('navigating to /admin redirects applicant to /experiences', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/experiences', { timeout: 10_000 });
    expect(page.url()).toContain('/experiences');

    // Admin nav/sidebar must NOT be visible
    await expect(page.getByRole('link', { name: /categories/i })).not.toBeVisible();
    await expect(page.getByRole('link', { name: /grants/i })).not.toBeVisible();
  });

  test('GET /api/mentor-grants with applicant session returns 403', async () => {
    const ctx = await playwrightRequest.newContext({
      storageState: applicantSessionFile,
    });
    const res = await ctx.get(`${API_BASE}/api/mentor-grants`);
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test('POST /api/experience-categories with applicant session returns 403', async () => {
    const ctx = await playwrightRequest.newContext({
      storageState: applicantSessionFile,
    });
    const res = await ctx.post(`${API_BASE}/api/experience-categories`, {
      data: { slug: 'rbac-test-cat', name: 'RBAC Test Category' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});
