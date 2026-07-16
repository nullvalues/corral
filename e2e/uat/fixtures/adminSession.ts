/**
 * UAT admin session fixture.
 *
 * Uses BetterAuthTotpDriver to provision a session for a well-known admin
 * account. The account email is read from UAT_ADMIN_EMAIL (default:
 * uat-admin@asp.dev).
 *
 * After BetterAuthTotpDriver.setup(), runs adminPromote.ts via execFileSync to
 * ensure the admin role, then signs in again to capture the post-promotion
 * storageState.
 *
 * Exports:
 *   storageStatePath — absolute path to the Playwright storageState JSON file
 *   setup()         — zero-arg async function; call once before tests
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BetterAuthTotpDriver } from '../drivers/BetterAuthTotpDriver';
import { generateTotpCode } from '../helpers/totp';

const EMAIL = process.env['UAT_ADMIN_EMAIL'] ?? 'uat-admin@asp.dev';
const PASSWORD = process.env['UAT_ADMIN_PASSWORD'] ?? 'UatAdmin1!';

const driver = new BetterAuthTotpDriver(
  path.join(os.tmpdir(), 'uat-admin.json'),
  process.env['API_BASE'] ?? 'http://localhost:6050',
);

export const storageStatePath = driver.storageStatePath;

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:6051';

export async function setup(): Promise<void> {
  const sidecarPath = `${storageStatePath}.totp-secret.txt`;

  // Attempt sign-in with existing sidecar secret if available.
  if (fs.existsSync(sidecarPath)) {
    try {
      await _signInWithSidecar(sidecarPath);
      console.log(`[UAT admin] signed in with existing session (${storageStatePath})`);
      if (process.env['DEBUG'] === 'true') {
        console.log(`[UAT admin] TOTP secret: ${fs.readFileSync(sidecarPath, 'utf8').trim()}`);
      }
      console.log(`[UAT admin] storageState: ${storageStatePath}`);
      return;
    } catch {
      console.log('[UAT admin] existing session sign-in failed; running full setup');
    }
  }

  // Full sign-up + TOTP enrolment via BetterAuthTotpDriver
  await driver.setup(EMAIL, PASSWORD);

  // Promote to admin role
  _promoteAdmin(EMAIL);

  // Sign in again to capture the post-promotion storageState
  await _signInWithSidecar(sidecarPath);

  const secret = fs.readFileSync(sidecarPath, 'utf8').trim();
  if (process.env['DEBUG'] === 'true') {
    console.log(`[UAT admin] TOTP secret: ${secret}`);
  }
  console.log(`[UAT admin] storageState: ${storageStatePath}`);
}

function _promoteAdmin(email: string): void {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL must be set to run UAT setup');
  const containerImage = process.env['CONTAINER_IMAGE'] ?? 'asp:local';

  if (process.env['CI']) {
    execFileSync(
      'docker',
      ['run', '--rm', '--network', 'host', '-e', `DATABASE_URL=${dbUrl}`, containerImage, 'admin:promote', `--email=${email}`],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync(
      'pnpm',
      ['tsx', 'api/src/scripts/adminPromote.ts', `--email=${email}`],
      { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' },
    );
  }
}

async function _signInWithSidecar(sidecarPath: string): Promise<void> {
  const secret = fs.readFileSync(sidecarPath, 'utf8').trim();

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE_URL });

  try {
    await page.goto(`${BASE_URL}/sign-in`);
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('button[type="submit"]');

    // twoFactorRedirect → SignIn.tsx navigates to /two-factor, the code-only
    // challenge screen, which renders #totp-code and posts verify-totp with the
    // challenge cookie.
    await page.waitForURL(/\/two-factor/, { timeout: 15_000 });
    const code = generateTotpCode(secret);
    await page.fill('#totp-code', code);
    await page.click('button[type="submit"]');

    await page.waitForURL('/', { timeout: 15_000 });
    await page.context().storageState({ path: storageStatePath });
  } finally {
    await browser.close();
  }
}
