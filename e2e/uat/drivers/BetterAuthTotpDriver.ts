/**
 * BetterAuthTotpDriver — AuthDriver implementation for the Better Auth + TOTP stack.
 *
 * Performs the full sign-up → TOTP enrolment → sign-in sequence via the API,
 * then saves Playwright storageState to `storageStatePath` and writes the TOTP
 * secret to a sidecar file at `<storageStatePath>.totp-secret.txt` so a tester
 * can paste it into an authenticator app.
 *
 * Idempotent across runs:
 *   - First run (fresh account created by seed:uat): signs up OR falls back to
 *     sign-in, detects twoFactorRedirect, reads the pre-enrolled secret from
 *     e2e/uat/.uat-secrets.json (written by UAT-026 seed step), then completes
 *     the TOTP verification challenge in the browser.
 *   - First run (no seed, truly new account): signs up, calls two-factor/enable
 *     to obtain the secret, verifies, then captures storageState.
 *   - Subsequent runs (account enrolled, .uat-secrets.json present): reads secret
 *     from .uat-secrets.json, skips API enrollment, navigates sign-in → TOTP
 *     challenge → storageState.
 *
 * Path detection (browser step):
 *   Sign-in for an already-enrolled account redirects to /two-factor (the
 *   code-only challenge screen). The driver waits for /two-factor, then supplies
 *   the TOTP code loaded from .uat-secrets.json.
 *
 * Steps 1–4 use native fetch() with manual Set-Cookie → Cookie forwarding,
 * matching the proven pattern in api/src/db/seed.uat.ts. Playwright's request
 * context does not reliably forward SameSite=Lax cookies in server-to-server
 * calls; native fetch with explicit cookie threading avoids the 401 on TOTP enable.
 *
 * Step 5 uses a real Chromium browser context to capture HttpOnly cookies as
 * Playwright storageState.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTotpCode } from '../helpers/totp';
import type { AuthDriver } from '../AuthDriver';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';
const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:6041';

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
 * Resolve the absolute path to e2e/uat/.uat-secrets.json.
 * This file is relative to the driver file:
 *   e2e/uat/drivers/BetterAuthTotpDriver.ts  →  ../  →  e2e/uat/
 */
function uatSecretsPath(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '..', '.uat-secrets.json');
}

/**
 * Look up the TOTP secret for the given email from .uat-secrets.json.
 * Returns undefined if the file does not exist or the email is not present.
 */
function loadSidecarSecret(email: string): string | undefined {
  const secretsFile = uatSecretsPath();
  if (!fs.existsSync(secretsFile)) return undefined;
  try {
    const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8')) as UatSecrets;
    for (const entry of Object.values(secrets)) {
      if (entry.email === email) return entry.totpSecret;
    }
  } catch {
    // Malformed file — ignore and fall through to enrollment path
  }
  return undefined;
}

export class BetterAuthTotpDriver implements AuthDriver {
  readonly role = 'applicant';

  constructor(
    public readonly storageStatePath: string,
    private readonly apiBase: string = API_BASE,
  ) {}

  async setup(email: string, password: string): Promise<void> {
    // ── 0. Pre-load sidecar secret if available (from seed:uat / UAT-026) ─────
    //
    // .uat-secrets.json is written by seed:uat before setup() is called.
    // If the email appears in the sidecar, the account is already enrolled;
    // sign in and verify TOTP entirely via the API, then write storageState
    // directly from the session cookie.  No browser launch needed.
    const sidecarSecret = loadSidecarSecret(email);
    if (sidecarSecret !== undefined) {
      // Browser-based sign-in so storageState contains real browser cookies.
      // Sign-in for an enrolled account navigates to /two-factor, the code-only
      // challenge screen, which renders #totp-code and posts verify-totp with
      // the two-factor challenge cookie.
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch();
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      try {
        await page.goto('/sign-in');
        await page.fill('#email', email);
        await page.fill('#password', password);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/two-factor/, { timeout: 15_000 });
        const code = generateTotpCode(sidecarSecret);
        await page.fill('#totp-code', code);
        await page.click('button[type="submit"]');
        await page.waitForURL('/', { timeout: 15_000 });
        await context.storageState({ path: this.storageStatePath });
      } finally {
        await browser.close();
      }
      fs.writeFileSync(`${this.storageStatePath}.totp-secret.txt`, sidecarSecret, 'utf8');
      return;
    }

    // ── 1. Sign up (or fall back to sign-in if account already exists) ────────
    let rawSessionCookie: string;
    let cookiePair: string;

    const signUpRes = await fetch(`${this.apiBase}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: this.apiBase },
      body: JSON.stringify({ email, password, name: email }),
    });

    if (!signUpRes.ok) {
      const text = await signUpRes.text();
      if (signUpRes.status !== 422) {
        throw new Error(`Sign-up failed: ${signUpRes.status} ${text}`);
      }
      // 422 = user already exists; fall back to sign-in
      const signInRes = await fetch(`${this.apiBase}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: this.apiBase },
        body: JSON.stringify({ email, password }),
      });
      if (!signInRes.ok) {
        throw new Error(`Sign-in fallback failed: ${signInRes.status} ${await signInRes.text()}`);
      }
      const signInBody = (await signInRes.json()) as Record<string, unknown>;
      if (signInBody['twoFactorRedirect'] === true) {
        // Account is already enrolled but .uat-secrets.json was absent or did
        // not contain this email. This should not happen when seed:uat ran
        // correctly; surface a clear recovery message.
        throw new Error(
          `User ${email} already has TOTP enrolled and no sidecar secret is available.\n` +
            `Run pnpm seed:uat to re-provision the account and regenerate e2e/uat/.uat-secrets.json.\n` +
            `If the account cannot be re-seeded, delete it from the database and re-run seed:uat:\n` +
            `  SQL: DELETE FROM users WHERE email = '${email}';`,
        );
      }
      rawSessionCookie = signInRes.headers.get('set-cookie') ?? '';
    } else {
      rawSessionCookie = signUpRes.headers.get('set-cookie') ?? '';
    }
    // Sign-up (fresh account) never triggers twoFactorRedirect, so only one
    // Set-Cookie is expected here.  Use split(';')[0] to extract name=value.
    cookiePair = rawSessionCookie.split(';')[0];

    // ── 2. Enable TOTP — session forwarded via Cookie header ─────────────────
    const enrolRes = await fetch(`${this.apiBase}/api/auth/two-factor/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: this.apiBase,
        Cookie: cookiePair,
      },
      body: JSON.stringify({ password }),
    });
    if (!enrolRes.ok) {
      throw new Error(`TOTP enable failed: ${enrolRes.status} ${await enrolRes.text()}`);
    }
    const { totpURI } = (await enrolRes.json()) as { totpURI: string };

    // ── 3. Parse secret from otpauth:// URI ───────────────────────────────────
    const parsed = new URL(totpURI).searchParams.get('secret');
    if (!parsed) throw new Error('No TOTP secret in URI');
    const secret = parsed;

    // ── 4. Verify TOTP — session cookie is now fully authenticated ────────────
    const code = generateTotpCode(secret);
    const verifyRes = await fetch(`${this.apiBase}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: this.apiBase,
        Cookie: cookiePair,
      },
      body: JSON.stringify({ code }),
    });
    if (!verifyRes.ok) {
      throw new Error(`TOTP verify failed: ${verifyRes.status} ${await verifyRes.text()}`);
    }

    // ── 5. Write storageState from the now-fully-authenticated session cookie ──
    // Merge: verify-totp cookies override sign-in cookies by name.
    const verifyCookies = _getSetCookies(verifyRes);
    this._writeStorageState(_mergeCookies([rawSessionCookie], verifyCookies));

    // ── 6. Write TOTP secret sidecar ──────────────────────────────────────────
    fs.writeFileSync(`${this.storageStatePath}.totp-secret.txt`, secret, 'utf8');
  }

  /**
   * Parse an array of raw Set-Cookie headers and write a Playwright-compatible
   * storageState JSON file to `this.storageStatePath`.
   */
  private _writeStorageState(rawCookies: string | string[]): void {
    const list = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    const cookies = list.filter(Boolean).map(_parseCookie);
    const storageState = { cookies, origins: [] as unknown[] };
    fs.writeFileSync(this.storageStatePath, JSON.stringify(storageState, null, 2), 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Cookie utilities
// ---------------------------------------------------------------------------

/** Return all Set-Cookie header values from a fetch Response (Node 18+). */
function _getSetCookies(res: Response): string[] {
  const headers = res.headers as unknown as { getSetCookie?(): string[] };
  return headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''].filter(Boolean);
}

/** Merge two cookie lists; later list overrides by cookie name. */
function _mergeCookies(base: string[], override: string[]): string[] {
  const byName = new Map<string, string>();
  for (const raw of [...base, ...override]) {
    const nameValue = raw.split(';')[0] ?? '';
    const eqIdx = nameValue.indexOf('=');
    const name = (eqIdx >= 0 ? nameValue.slice(0, eqIdx) : nameValue).trim();
    if (name) byName.set(name, raw);
  }
  return [...byName.values()];
}

/** Parse a raw Set-Cookie header into a Playwright cookie object. */
function _parseCookie(rawSetCookie: string): {
  name: string; value: string; domain: string; path: string;
  expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax' | 'Strict' | 'None';
} {
  const parts = rawSetCookie.split(';').map((s) => s.trim());
  const nameValue = parts[0] ?? '';
  const eqIdx = nameValue.indexOf('=');
  const name = (eqIdx >= 0 ? nameValue.slice(0, eqIdx) : nameValue).trim();
  const value = eqIdx >= 0 ? nameValue.slice(eqIdx + 1) : '';

  let httpOnly = false;
  let secure = false;
  let sameSite: 'Lax' | 'Strict' | 'None' = 'Lax';
  let expires = -1;

  for (const part of parts.slice(1)) {
    const lower = part.toLowerCase();
    if (lower === 'httponly') {
      httpOnly = true;
    } else if (lower === 'secure') {
      secure = true;
    } else if (lower.startsWith('samesite=')) {
      const v = part.slice(9).trim();
      sameSite = (v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()) as 'Lax' | 'Strict' | 'None';
    } else if (lower.startsWith('max-age=')) {
      const maxAge = parseInt(part.slice(8), 10);
      if (!isNaN(maxAge)) expires = Math.floor(Date.now() / 1000) + maxAge;
    } else if (lower.startsWith('expires=')) {
      const d = new Date(part.slice(8));
      if (!isNaN(d.getTime())) expires = Math.floor(d.getTime() / 1000);
    }
  }

  return { name, value, domain: 'localhost', path: '/', expires, httpOnly, secure, sameSite };
}
