import { test, expect } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import * as fs from 'fs';
import { setupApplicantSession, applicantSessionFile } from './fixtures/applicantSession.js';
import { setupAdminSession, adminSessionFile } from './fixtures/adminSession.js';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

test.beforeAll(async () => {
  if (!fs.existsSync(applicantSessionFile)) await setupApplicantSession();
  if (!fs.existsSync(adminSessionFile)) await setupAdminSession();
});

test.describe('applicant redirect', () => {
  test.use({ storageState: applicantSessionFile });
  test('landing at / redirects to /home', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/home**', { timeout: 10_000 });
    expect(page.url()).toContain('/home');
  });
});

test.describe('admin redirect', () => {
  test.use({ storageState: adminSessionFile });
  test('landing at / redirects to /admin', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/admin**', { timeout: 10_000 });
    expect(page.url()).toContain('/admin');
  });
});

test.describe('admin write-block on experience mutations', () => {
  test('POST /api/experiences with admin session returns 403', async () => {
    const ctx = await playwrightRequest.newContext({ storageState: adminSessionFile });
    const res = await ctx.post(`${API_BASE}/api/experiences`, {
      data: {
        categoryId: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
        organization: 'Test Org',
        position: 'Tester',
        startDate: '2024-01-01',
        dutiesNarrative: 'Testing duties',
        totalHours: 40,
        hoursPerWeek: 10,
        numberOfWeeks: 4,
      },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});
