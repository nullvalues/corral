/**
 * Smoke test for BetterAuthTotpDriver.
 *
 * This test requires a running API server and is skipped by default.
 * To run it manually: remove `.skip` below and ensure the dev server is up.
 *
 * Assertions:
 *   - storageState file is written to disk
 *   - TOTP secret sidecar file is written and non-empty
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BetterAuthTotpDriver } from './BetterAuthTotpDriver';

test.skip('BetterAuthTotpDriver smoke: writes storageState and TOTP secret sidecar', async () => {
  const storageStatePath = path.join(os.tmpdir(), `uat-smoke-${randomUUID()}.json`);
  const driver = new BetterAuthTotpDriver(storageStatePath);

  const email = `uat-smoke+${randomUUID()}@example.com`;
  const password = 'Test1234!';

  await driver.setup(email, password);

  // storageState file must exist
  expect(fs.existsSync(storageStatePath)).toBe(true);

  // TOTP secret sidecar must exist and be non-empty
  const sidecarPath = `${storageStatePath}.totp-secret.txt`;
  expect(fs.existsSync(sidecarPath)).toBe(true);
  const secret = fs.readFileSync(sidecarPath, 'utf8');
  expect(secret.trim().length).toBeGreaterThan(0);

  // Clean up
  fs.unlinkSync(storageStatePath);
  fs.unlinkSync(sidecarPath);
});
