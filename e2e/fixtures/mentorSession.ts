// E2E mentor session fixture
// Signs up a fresh mentor user, enrols TOTP, and signs in via UI.
// Saves storageState to a tmp file. Returns the mentor userId.
//
// Shared auth flow is in e2e/helpers/sessionSetup.ts (TEST-057).
//
// NOTE: Do NOT create the mentor grant inside this fixture — the grant
// requires both admin credentials and the applicant userId. The spec's
// beforeAll does this after both sessions are set up.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { request as playwrightRequest } from '@playwright/test';
import { signUpAndEnrolTotp, signInWithTotp, writeStorageState } from '../helpers/sessionSetup.js';

export const mentorSessionFile = path.join(os.tmpdir(), 'asp-mentor-session.json');

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';

export async function setupMentorSession(): Promise<{ userId: string; email: string }> {
  const email = `mentor+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  // signUpAndEnrolTotp uses native fetch internally; the request context
  // parameter is accepted for interface compatibility but is not used for
  // the sign-up / enrolment steps.
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });
  const totpSecret = await signUpAndEnrolTotp(ctx, API_BASE, email, password);
  await ctx.dispose();

  // ── Sign in via UI and capture storageState ───────────────────────────────
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await signInWithTotp(page, email, password, totpSecret);
  await writeStorageState(page, mentorSessionFile);

  await browser.close();

  // ── Get userId via /api/me using the saved storageState ──────────────────
  const meCtx = await playwrightRequest.newContext({
    baseURL: API_BASE,
    storageState: mentorSessionFile,
  });
  const meRes = await meCtx.get(`${API_BASE}/api/me`);
  if (!meRes.ok()) {
    throw new Error(`Mentor GET /api/me failed: ${meRes.status()} ${await meRes.text()}`);
  }
  const meBody = (await meRes.json()) as { user: { id: string } };
  const userId = meBody.user.id;
  await meCtx.dispose();

  return { userId, email };
}

// Verify the file exists (useful for conditional setup)
export function mentorSessionExists(): boolean {
  return fs.existsSync(mentorSessionFile);
}
