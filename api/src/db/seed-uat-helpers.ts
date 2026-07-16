/**
 * Helper functions for seed.uat.ts — extracted to allow unit testing without
 * executing the top-level seed script body.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, sessions, accounts, verification, twoFactor } from './schema/auth.js';

/** Delay helper — waits the given number of milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delete all Better Auth records for the given email address, including
 * sessions, accounts, verification tokens, two-factor rows, and the user
 * row itself.  Safe to call when the account does not exist — all deletes
 * are guarded by a WHERE clause and produce no error if no rows match.
 */
export async function deleteAccountByEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  email: string,
): Promise<void> {
  // Resolve the user id first so we can cascade-delete child rows.
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (!user) {
    // No account to delete — nothing to do.
    return;
  }

  const userId = user.id;

  // Delete child rows before the parent user row (FK-style ordering, even
  // though Drizzle does not enforce cross-boundary FKs — belt-and-suspenders).
  await db.delete(verification).where(eq(verification.identifier, email));
  await db.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Create a fresh account via the Better Auth sign-up endpoint.
 * Returns the BA user id.
 *
 * The caller must ensure the account does not already exist before calling
 * this function (i.e. call deleteAccountByEmail first).
 *
 * 429 handling: if the rate limiter fires, waits RETRY_DELAY_MS and retries
 * the sign-up, up to MAX_ATTEMPTS total attempts before throwing.
 */
export async function ensureAccount(
  email: string,
  password: string,
  apiBase: string,
  origin: string,
  opts: { maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<string> {
  const MAX_ATTEMPTS = opts.maxAttempts ?? 3;
  const RETRY_DELAY_MS = opts.retryDelayMs ?? 2000;

  let signUpRes: Response | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    signUpRes = await fetch(`${apiBase}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password, name: email.split('@')[0] }),
    });

    if (signUpRes.status !== 429) break;

    // Rate limited — wait and retry (unless this was the final attempt)
    if (attempt < MAX_ATTEMPTS) {
      const retryAfterHeader = signUpRes.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader !== null ? parseInt(retryAfterHeader, 10) : NaN;
      let waitMs: number;
      let waitSource: string;
      if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
        waitMs = (retryAfterSeconds + 1) * 1000;
        waitSource = ` (Retry-After: ${retryAfterSeconds}s)`;
      } else {
        waitMs = RETRY_DELAY_MS;
        waitSource = '';
      }
      console.warn(
        `  sign-up for ${email} rate-limited (429) — retrying in ${waitMs}ms${waitSource} (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await delay(waitMs);
    }
  }

  // signUpRes is always set here (MAX_ATTEMPTS >= 1)
  const res = signUpRes!;

  if (res.status === 429) {
    const text = await res.text();
    throw new Error(`sign-up for ${email} returned 429 after ${MAX_ATTEMPTS} attempts: ${text}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sign-up for ${email} failed ${res.status}: ${text}`);
  }

  const body = (await res.json()) as { user?: { id: string } };
  const id = body.user?.id;
  if (!id) throw new Error(`sign-up for ${email} returned ok but no user.id`);
  return id;
}

/**
 * Enrol TOTP for an account that was just created via ensureAccount().
 *
 * Performs:
 *  1. Sign in via email/password to get a session cookie.
 *  2. POST /api/auth/two-factor/enable → receive totpURI.
 *  3. Parse the base32 secret from the otpauth:// URI.
 *  4. Generate a TOTP code and POST /api/auth/two-factor/verify-totp.
 *
 * Returns the base32-encoded TOTP secret so the caller can persist it.
 *
 * @param email      The account email address.
 * @param password   The account password.
 * @param apiBase    The API base URL (e.g. http://localhost:6050).
 * @param origin     The Origin header value to send (usually == apiBase).
 */
export async function enrollTotp(
  email: string,
  password: string,
  apiBase: string,
  origin: string,
): Promise<string> {
  // ── 1. Sign in to obtain a session cookie ────────────────────────────────
  const signInRes = await fetch(`${apiBase}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  if (!signInRes.ok) {
    const text = await signInRes.text();
    throw new Error(`enrollTotp: sign-in for ${email} failed ${signInRes.status}: ${text}`);
  }
  const cookiePair = (signInRes.headers.get('set-cookie') ?? '').split(';')[0];

  // ── 2. Enable TOTP — session forwarded via Cookie header ─────────────────
  const enableRes = await fetch(`${apiBase}/api/auth/two-factor/enable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookiePair,
    },
    body: JSON.stringify({ password }),
  });
  if (!enableRes.ok) {
    const text = await enableRes.text();
    throw new Error(`enrollTotp: TOTP enable for ${email} failed ${enableRes.status}: ${text}`);
  }
  const { totpURI } = (await enableRes.json()) as { totpURI: string };

  // ── 3. Parse secret from otpauth:// URI ───────────────────────────────────
  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error(`enrollTotp: no TOTP secret in URI for ${email}`);

  // ── 4. Verify TOTP to complete enrolment ─────────────────────────────────
  // We use dynamic import so that `otplib` is only loaded at runtime (not at
  // module parse time in test environments that mock fetch).
  const { generateSync } = await import('otplib');
  const code = generateSync({ secret });

  const verifyRes = await fetch(`${apiBase}/api/auth/two-factor/verify-totp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookiePair,
    },
    body: JSON.stringify({ code }),
  });
  if (!verifyRes.ok) {
    const text = await verifyRes.text();
    throw new Error(`enrollTotp: TOTP verify for ${email} failed ${verifyRes.status}: ${text}`);
  }

  return secret;
}

/**
 * Shape of one entry in the UAT secrets sidecar file.
 */
export interface UatSecretEntry {
  email: string;
  totpSecret: string;
}

/**
 * Shape of the full UAT secrets sidecar file.
 */
export interface UatSecrets {
  applicant: UatSecretEntry;
  mentor: UatSecretEntry;
  admin: UatSecretEntry;
}

/**
 * Write the UAT secrets sidecar file to `e2e/uat/.uat-secrets.json` at the
 * monorepo root.
 *
 * The path is resolved relative to this file's location:
 *   api/src/db/seed-uat-helpers.ts  →  ../../../  →  <monorepo-root>
 *
 * Overwrites any existing file (re-running seed:uat should refresh secrets).
 */
export function writeUatSecrets(secrets: UatSecrets): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(__dirname, '../../../', 'e2e/uat/.uat-secrets.json');
  fs.writeFileSync(outPath, JSON.stringify(secrets, null, 2), 'utf8');
}
