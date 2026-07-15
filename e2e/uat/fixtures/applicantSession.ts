/**
 * UAT applicant session fixture.
 *
 * Uses BetterAuthTotpDriver to provision a session for a well-known applicant
 * account. The account email is read from UAT_APPLICANT_EMAIL (default:
 * uat-applicant@asp.dev). The UAT seed (UAT-004) provisions this account;
 * this fixture signs in to it.
 *
 * Sign-in detection: if a TOTP secret sidecar already exists from a previous
 * run, attempt UI sign-in with the stored secret. Fall back to full sign-up
 * via BetterAuthTotpDriver if the sidecar is absent or sign-in fails.
 *
 * Exports:
 *   storageStatePath — absolute path to the Playwright storageState JSON file
 *   setup()         — zero-arg async function; call once before tests
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BetterAuthTotpDriver } from '../drivers/BetterAuthTotpDriver';
import { generateTotpCode } from '../helpers/totp';

const EMAIL = process.env['UAT_APPLICANT_EMAIL'] ?? 'uat-applicant@asp.dev';
const PASSWORD = process.env['UAT_APPLICANT_PASSWORD'] ?? 'UatApplicant1!';

const driver = new BetterAuthTotpDriver(
  path.join(os.tmpdir(), 'uat-applicant.json'),
  process.env['API_BASE'] ?? 'http://localhost:6040',
);

export const storageStatePath = driver.storageStatePath;

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:6041';

export async function setup(): Promise<void> {
  const sidecarPath = `${storageStatePath}.totp-secret.txt`;

  // Attempt sign-in with existing sidecar secret if available.
  if (fs.existsSync(sidecarPath)) {
    try {
      await _signInWithSidecar(sidecarPath);
      console.log(`[UAT applicant] signed in with existing session (${storageStatePath})`);
      if (process.env['DEBUG'] === 'true') {
        console.log(`[UAT applicant] TOTP secret: ${fs.readFileSync(sidecarPath, 'utf8').trim()}`);
      }
      console.log(`[UAT applicant] storageState: ${storageStatePath}`);
      return;
    } catch {
      // Fall through to full sign-up
      console.log('[UAT applicant] existing session sign-in failed; running full setup');
    }
  }

  // Full sign-up + TOTP enrolment via BetterAuthTotpDriver
  await driver.setup(EMAIL, PASSWORD);

  const secret = fs.readFileSync(sidecarPath, 'utf8').trim();
  if (process.env['DEBUG'] === 'true') {
    console.log(`[UAT applicant] TOTP secret: ${secret}`);
  }
  console.log(`[UAT applicant] storageState: ${storageStatePath}`);
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

    // twoFactorRedirect → SignIn.tsx navigates to /enrol.
    // TotpEnrol may fail /enable (401 — no full session yet) but always renders
    // #totp-code, so verify-totp can be submitted with the challenge cookie.
    await page.waitForURL(/\/enrol/, { timeout: 15_000 });
    const code = generateTotpCode(secret);
    await page.fill('#totp-code', code);
    await page.click('button[type="submit"]');

    await page.waitForURL('/', { timeout: 15_000 });
    await page.context().storageState({ path: storageStatePath });
  } finally {
    await browser.close();
  }
}
