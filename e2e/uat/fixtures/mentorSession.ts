/**
 * UAT mentor session fixture.
 *
 * Uses BetterAuthTotpDriver to provision a session for a well-known mentor
 * account. The account email is read from UAT_MENTOR_EMAIL (default:
 * uat-mentor@asp.dev).
 *
 * After BetterAuthTotpDriver.setup(), uses an admin Playwright request context
 * (loaded from the admin storageState) to POST /api/mentor-grants, creating a
 * grant so the mentor can see the applicant's experiences.
 *
 * Pre-requisite: adminSession.setup() must have been called before this fixture
 * so the admin storageState file is available.
 *
 * Exports:
 *   storageStatePath — absolute path to the Playwright storageState JSON file
 *   setup()         — zero-arg async function; call once before tests
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { BetterAuthTotpDriver } from '../drivers/BetterAuthTotpDriver';
import { generateTotpCode } from '../helpers/totp';
import { storageStatePath as adminStorageStatePath } from './adminSession';

const EMAIL = process.env['UAT_MENTOR_EMAIL'] ?? 'uat-mentor@asp.dev';
const PASSWORD = process.env['UAT_MENTOR_PASSWORD'] ?? 'UatMentor1!';

const APPLICANT_EMAIL = process.env['UAT_APPLICANT_EMAIL'] ?? 'uat-applicant@asp.dev';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';

const driver = new BetterAuthTotpDriver(
  path.join(os.tmpdir(), 'uat-mentor.json'),
  API_BASE,
);

export const storageStatePath = driver.storageStatePath;

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:6041';

export async function setup(): Promise<void> {
  const sidecarPath = `${storageStatePath}.totp-secret.txt`;

  // Attempt sign-in with existing sidecar secret if available.
  if (fs.existsSync(sidecarPath)) {
    try {
      await _signInWithSidecar(sidecarPath);
      console.log(`[UAT mentor] signed in with existing session (${storageStatePath})`);
      if (process.env['DEBUG'] === 'true') {
        console.log(`[UAT mentor] TOTP secret: ${fs.readFileSync(sidecarPath, 'utf8').trim()}`);
      }
      console.log(`[UAT mentor] storageState: ${storageStatePath}`);
      return;
    } catch {
      console.log('[UAT mentor] existing session sign-in failed; running full setup');
    }
  }

  // Full sign-up + TOTP enrolment via BetterAuthTotpDriver
  await driver.setup(EMAIL, PASSWORD);

  // Create mentor grant via admin API
  await _createMentorGrant();

  const secret = fs.readFileSync(sidecarPath, 'utf8').trim();
  if (process.env['DEBUG'] === 'true') {
    console.log(`[UAT mentor] TOTP secret: ${secret}`);
  }
  console.log(`[UAT mentor] storageState: ${storageStatePath}`);
}

/**
 * Resolve user ID for a given email by calling GET /api/users?email=<email>
 * using an admin-authenticated request context loaded from the admin storageState.
 */
async function _getUserIdByEmail(adminCtx: Awaited<ReturnType<typeof playwrightRequest.newContext>>, email: string): Promise<string> {
  const res = await adminCtx.get(`${API_BASE}/api/users?email=${encodeURIComponent(email)}`);
  if (!res.ok()) {
    throw new Error(`GET /api/users failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as Array<{ id: string; email: string }>;
  const user = body.find((u) => u.email === email);
  if (!user) throw new Error(`User not found for email: ${email}`);
  return user.id;
}

async function _createMentorGrant(): Promise<void> {
  if (!fs.existsSync(adminStorageStatePath)) {
    throw new Error(
      `Admin storageState not found at ${adminStorageStatePath}. Run adminSession.setup() before mentorSession.setup().`,
    );
  }

  // Load admin cookies from storageState
  const adminState = JSON.parse(fs.readFileSync(adminStorageStatePath, 'utf8')) as {
    cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }>;
  };

  const adminCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: adminState as Parameters<typeof playwrightRequest.newContext>[0]['storageState'],
  });

  try {
    // Resolve user IDs for mentor and applicant
    const mentorUserId = await _getUserIdByEmail(adminCtx, EMAIL);
    const applicantUserId = await _getUserIdByEmail(adminCtx, APPLICANT_EMAIL);

    // Create mentor grant (idempotent — ignore 409 conflict if grant already exists)
    const grantRes = await adminCtx.post(`${API_BASE}/api/mentor-grants`, {
      data: { mentorUserId, applicantUserId, permissions: [] },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!grantRes.ok() && grantRes.status() !== 409) {
      throw new Error(`POST /api/mentor-grants failed: ${grantRes.status()} ${await grantRes.text()}`);
    }

    console.log(`[UAT mentor] mentor grant created for mentor=${mentorUserId} applicant=${applicantUserId}`);
  } finally {
    await adminCtx.dispose();
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
