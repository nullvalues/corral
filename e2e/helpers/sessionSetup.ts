// Shared E2E session-setup helpers — extracted from applicantSession, adminSession,
// mentorSession fixtures (TEST-057). All three fixtures shared ~80% duplicate
// sign-up / TOTP-enrolment / sign-in / storageState logic; only role-specific
// pieces remain in each fixture file.
//
// Cookie threading note: sign-up and TOTP enrolment use native fetch() with
// explicit Set-Cookie → Cookie forwarding. Playwright's APIRequestContext does
// not reliably forward SameSite=Lax cookies in server-to-server calls; native
// fetch avoids the 401 on the TOTP enable call (proven pattern, UI-092 fix).

import type { APIRequestContext, Page } from '@playwright/test';
import { generateSync } from 'otplib';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

/**
 * Sign up a new user and enrol TOTP via the Better Auth HTTP endpoints
 * (raw fetch with cookie threading). Returns the TOTP secret.
 *
 * Includes the UI-092 fix: the password is passed to the two-factor/enable
 * call so Better Auth accepts the request.
 */
export async function signUpAndEnrolTotp(
  _request: APIRequestContext,
  _baseURL: string,
  email: string,
  password: string,
): Promise<string> {
  // ── 1. Sign up via API ────────────────────────────────────────────────────
  const signUpRes = await fetch(`${API_BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API_BASE },
    body: JSON.stringify({ email, password, name: email }),
  });
  if (!signUpRes.ok) {
    throw new Error(`Sign-up failed: ${signUpRes.status} ${await signUpRes.text()}`);
  }
  const cookiePair = (signUpRes.headers.get('set-cookie') ?? '').split(';')[0];

  // ── 2. Enable TOTP via API (UI-092: password required) ───────────────────
  const enableRes = await fetch(`${API_BASE}/api/auth/two-factor/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API_BASE, Cookie: cookiePair },
    body: JSON.stringify({ password }),
  });
  if (!enableRes.ok) {
    throw new Error(`TOTP enable failed: ${enableRes.status} ${await enableRes.text()}`);
  }
  const { totpURI } = (await enableRes.json()) as { totpURI: string };

  // ── 3. Parse secret from otpauth:// URI ──────────────────────────────────
  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error('No TOTP secret in URI');
  const code = generateSync({ secret });

  // ── 4. Verify TOTP via API ────────────────────────────────────────────────
  const verifyRes = await fetch(`${API_BASE}/api/auth/two-factor/verify-totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API_BASE, Cookie: cookiePair },
    body: JSON.stringify({ code }),
  });
  if (!verifyRes.ok) {
    throw new Error(`TOTP verify failed: ${verifyRes.status} ${await verifyRes.text()}`);
  }

  return secret;
}

/**
 * Sign in through the UI, completing the TOTP challenge with a code generated
 * from the secret. Waits for navigation to '/' after a successful challenge.
 */
export async function signInWithTotp(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  await page.goto('/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');

  // After credentials the app redirects to the TOTP challenge page
  await page.waitForURL(/\/(enrol|two-factor)/, { timeout: 15_000 });

  // Generate a fresh TOTP code from the secret and submit
  const code = generateSync({ secret: totpSecret });
  await page.fill('#totp-code', code);
  await page.click('button[type="submit"]');

  // Wait for navigation away from the auth flow — the app may redirect to
  // '/', '/home', or '/admin' depending on the user's role.
  await page.waitForURL(/^(?!.*\/(sign-in|enrol|two-factor)).*$/, { timeout: 15_000 });
}

/**
 * Persist the authenticated browser state to the given storage-state path.
 */
export async function writeStorageState(page: Page, storagePath: string): Promise<void> {
  await page.context().storageState({ path: storagePath });
}
