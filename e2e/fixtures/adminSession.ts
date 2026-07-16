// E2E admin session fixture
// Signs up a fresh admin user, enrols TOTP, promotes to admin, signs in via UI,
// and saves storageState. The admin userId is returned.
//
// Shared auth flow is in e2e/helpers/sessionSetup.ts (TEST-057).
//
// Promote mechanism:
//   - CI (process.env['CI']): docker run --rm --network host ...
//   - Locally: pnpm tsx api/src/scripts/adminPromote.ts --email=<email>

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { request as playwrightRequest } from '@playwright/test';
import { signUpAndEnrolTotp, signInWithTotp, writeStorageState } from '../helpers/sessionSetup.js';

export const adminSessionFile = path.join(os.tmpdir(), 'asp-admin-session.json');

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

export async function setupAdminSession(): Promise<{ userId: string }> {
  const email = `admin+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  // signUpAndEnrolTotp uses native fetch internally; the request context
  // parameter is accepted for interface compatibility but is not used for
  // the sign-up / enrolment steps.
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });
  const totpSecret = await signUpAndEnrolTotp(ctx, API_BASE, email, password);
  await ctx.dispose();

  // ── Promote to admin ──────────────────────────────────────────────────────
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL must be set to run this E2E test');
  const containerImage = process.env['CONTAINER_IMAGE'] ?? 'asp:local';

  if (process.env['CI']) {
    execFileSync('docker', [
      'run', '--rm', '--network', 'host',
      '-e', `DATABASE_URL=${dbUrl}`,
      containerImage,
      'admin:promote',
      `--email=${email}`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('pnpm', [
      'tsx',
      'api/src/scripts/adminPromote.ts',
      `--email=${email}`,
    ], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });
  }

  // ── Sign in via UI and capture storageState ───────────────────────────────
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await signInWithTotp(page, email, password, totpSecret);
  await writeStorageState(page, adminSessionFile);

  await browser.close();

  // ── Get userId via /api/me using the saved storageState ──────────────────
  const meCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: adminSessionFile,
  });
  const meRes = await meCtx.get(`${API_BASE}/api/me`);
  if (!meRes.ok()) {
    throw new Error(`Admin GET /api/me failed: ${meRes.status()} ${await meRes.text()}`);
  }
  const meBody = (await meRes.json()) as { user: { id: string } };
  const userId = meBody.user.id;
  await meCtx.dispose();

  return { userId };
}

// Verify the file exists (useful for conditional setup)
export function adminSessionExists(): boolean {
  return fs.existsSync(adminSessionFile);
}
