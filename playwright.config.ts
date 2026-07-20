import { defineConfig, devices } from '@playwright/test';

// Environment-variable-driven server configuration.
//
// CONTAINER_IMAGE  — when set, Playwright starts a Docker container using this
//                    image (e.g. "asp:local"). When absent, Playwright starts
//                    the monorepo dev servers via `pnpm dev`.
// BASE_URL         — the URL Playwright navigates to. Defaults to the
//                    container port (6080) when CONTAINER_IMAGE is set, and to
//                    the UI dev-server port (6081) otherwise.
// READINESS_URL    — the URL Playwright polls before any test starts. Defaults
//                    to BASE_URL + /api/health.

const containerImage = process.env['CONTAINER_IMAGE'];

const defaultBase = containerImage ? 'http://localhost:6080' : 'http://localhost:6081';
const baseURL = process.env['BASE_URL'] ?? defaultBase;

const defaultReadiness = containerImage
  ? 'http://localhost:6080/api/health'
  : `${baseURL}/api/health`;
const readinessURL = process.env['READINESS_URL'] ?? defaultReadiness;

const webServerCommand = containerImage
  ? [
      'docker run --rm --name asp-e2e --network host',
      '-e NODE_ENV',
      '-e DATABASE_URL',
      '-e SESSION_SECRET',
      '-e MFA_ENABLED',
      '-e PORT',
      '-e STATIC_UI_ROOT',
      '-e MAILER_PROVIDER',
      '-e MAILER_FROM',
      '-e ALLOWED_ORIGIN',
      `${containerImage} serve`,
    ].join(' ')
  : 'pnpm dev';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: webServerCommand,
    url: readinessURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
