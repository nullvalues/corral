// E2E applicant session fixture
// Performs sign-up + TOTP enrolment + sign-in exactly once and writes
// storageState to a tmp file. Subsequent test files use:
//   test.use({ storageState: applicantSessionFile })
//
// Shared auth flow is in e2e/helpers/sessionSetup.ts (TEST-057).
//
// Pre-requisite: at least one active experience category must exist in the
// database. Run `pnpm --filter @asp/api db:seed` before E2E tests.

import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { request as playwrightRequest } from '@playwright/test';
import { signUpAndEnrolTotp, signInWithTotp, writeStorageState } from '../helpers/sessionSetup.js';

export const applicantSessionFile = path.join(os.tmpdir(), 'asp-applicant-session.json');

export async function setupApplicantSession(): Promise<void> {
  const email = `applicant+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  // signUpAndEnrolTotp uses native fetch internally; the request context
  // parameter is accepted for interface compatibility but is not used for
  // the sign-up / enrolment steps.
  const ctx = await playwrightRequest.newContext();
  const totpSecret = await signUpAndEnrolTotp(ctx, '', email, password);
  await ctx.dispose();

  // Sign in via UI and capture storageState
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await signInWithTotp(page, email, password, totpSecret);
  await writeStorageState(page, applicantSessionFile);

  await browser.close();
}
