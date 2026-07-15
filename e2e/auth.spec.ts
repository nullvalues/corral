// E2E tests require live dev servers:
//   API: pnpm --filter @asp/api dev  (port 6040)
//   UI:  pnpm --filter @asp/ui dev   (port 6041)
// Not included in CI — intended for local pre-merge runs.
//
// The per-role sign-in tests (TEST-029) additionally require:
//   - pnpm seed:uat to have run (accounts exist with TOTP enrolled)
//   - e2e/uat/.uat-secrets.json present (written by seed:uat)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { generateSync } from 'otplib';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';

// ---------------------------------------------------------------------------
// UAT per-role login + TOTP tests (TEST-029)
// ---------------------------------------------------------------------------

/** Shape of one entry in e2e/uat/.uat-secrets.json */
interface UatSecretEntry {
  email: string;
  totpSecret: string;
}

/** Shape of the full .uat-secrets.json sidecar */
interface UatSecrets {
  applicant: UatSecretEntry;
  mentor: UatSecretEntry;
  admin: UatSecretEntry;
}

/**
 * Read the UAT secrets sidecar file.
 * Throws a descriptive error if the file is absent — guides the operator to
 * run `pnpm seed:uat` first.
 */
function loadUatSecrets(): UatSecrets {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const secretsPath = path.resolve(__dirname, 'uat', '.uat-secrets.json');
  if (!fs.existsSync(secretsPath)) {
    throw new Error(
      `e2e/uat/.uat-secrets.json not found.\n` +
        `Run \`pnpm seed:uat\` to provision UAT accounts and generate the secrets file.`,
    );
  }
  return JSON.parse(fs.readFileSync(secretsPath, 'utf8')) as UatSecrets;
}

/**
 * Known passwords for the stable UAT accounts provisioned by seed:uat.
 * These match the constants in api/src/db/seed.uat.ts.
 */
const UAT_PASSWORDS: Record<string, string> = {
  'uat-applicant@asp.dev': 'UatApplicant1!',
  'uat-mentor@asp.dev': 'UatMentor1!',
  'uat-admin@asp.dev': 'UatAdmin1!',
};

/**
 * Sign in via the UI with email + password, complete the TOTP challenge using
 * the provided base32 secret, and assert the browser lands on `/`.
 *
 * Each call receives a fresh `page` from Playwright (no pre-loaded storageState).
 */
async function signInWithTotp(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  await page.goto('/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');

  // After credentials, the app redirects to /enrol for the TOTP challenge
  // (MFA_REQUIRED gate in protectedScope sends unenrolled/unverified users there).
  await page.waitForURL(/\/(enrol|totp|two-factor)/, { timeout: 15_000 });

  // Generate a fresh TOTP code from the sidecar secret and submit
  const code = generateSync({ secret: totpSecret });
  await page.fill('#totp-code', code);
  await page.click('button[type="submit"]');

  // Assert successful navigation to the authenticated home route
  await page.waitForURL('/', { timeout: 15_000 });
}

test('applicant — sign in with email + password + TOTP, lands on /', async ({ page }) => {
  const secrets = loadUatSecrets();
  const { email, totpSecret } = secrets.applicant;
  const password = UAT_PASSWORDS[email] ?? 'UatApplicant1!';
  await signInWithTotp(page, email, password, totpSecret);
  expect(page.url()).toContain('/');
});

test('mentor — sign in with email + password + TOTP, lands on /', async ({ page }) => {
  const secrets = loadUatSecrets();
  const { email, totpSecret } = secrets.mentor;
  const password = UAT_PASSWORDS[email] ?? 'UatMentor1!';
  await signInWithTotp(page, email, password, totpSecret);
  expect(page.url()).toContain('/');
});

test('admin — sign in with email + password + TOTP, lands on /', async ({ page }) => {
  const secrets = loadUatSecrets();
  const { email, totpSecret } = secrets.admin;
  const password = UAT_PASSWORDS[email] ?? 'UatAdmin1!';
  await signInWithTotp(page, email, password, totpSecret);
  expect(page.url()).toContain('/');
});

test('sign-up → TOTP enrolment → sign-in round trip', async ({ page, request }) => {
  const email = `test+${Date.now()}@example.com`;
  const password = 'Test1234!';

  // ── 1. Sign up via API ──────────────────────────────────────────────────────
  const signUpRes = await request.post(`${API_BASE}/api/auth/sign-up/email`, {
    data: { email, password, name: email },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(signUpRes.ok()).toBeTruthy();

  // ── 2. Enable TOTP via API to obtain totpURI ────────────────────────────────
  // Better Auth checks Origin for CSRF on authenticated endpoints; send the
  // server's own origin so it is treated as same-origin (matches seed.uat.ts).
  const enableRes = await request.post(`${API_BASE}/api/auth/two-factor/enable`, {
    data: { password },
    headers: { 'Content-Type': 'application/json', Origin: API_BASE },
  });
  expect(enableRes.ok()).toBeTruthy();
  const { totpURI } = await enableRes.json() as { totpURI: string };

  // ── 3. Parse secret from otpauth:// URI and generate a valid TOTP code ──────
  const secret = new URL(totpURI).searchParams.get('secret');
  expect(secret).toBeTruthy();
  const code = generateSync({ secret: secret! });

  // ── 4. Verify TOTP via API ──────────────────────────────────────────────────
  const verifyRes = await request.post(`${API_BASE}/api/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { 'Content-Type': 'application/json', Origin: API_BASE },
  });
  expect(verifyRes.ok()).toBeTruthy();

  // ── 5. UI: sign-in page → /enrol (TOTP challenge) ───────────────────────────
  // The account is already enrolled (steps 1-4). Sign-in triggers
  // twoFactorRedirect and SignIn.tsx navigates to /enrol for the TOTP challenge.
  await page.goto('/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/enrol/, { timeout: 15_000 });

  // ── 6. Assert TOTP code input is visible ────────────────────────────────────
  await expect(page.locator('#totp-code')).toBeVisible();

  // ── 7. Enter TOTP code and complete sign-in ──────────────────────────────────
  const uiCode = generateSync({ secret: secret! });
  await page.fill('#totp-code', uiCode);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });

  // ── 8. Assert protected placeholder is visible ───────────────────────────────
  await expect(page.getByText('protected placeholder')).toBeVisible();
});
