# UAT Harness

This directory contains the User Acceptance Testing harness for asp.

## Purpose

The harness provides a role-based `AuthDriver` abstraction that UAT specs use
to establish authenticated Playwright sessions without duplicating sign-in
boilerplate. Each role (applicant, admin, mentor) has its own driver
implementation that handles sign-up, TOTP enrolment, optional promotion, and
storageState capture.

## Quick start — single command

```bash
pnpm uat
```

This single command (defined in the root `package.json`) runs the full UAT flow
end to end:

1. Starts the monorepo dev servers (`pnpm dev`).
2. Waits for the API health endpoint (`http://localhost:6080/api/health`) to
   become ready (up to 120 s).
3. Runs `pnpm seed:uat` to provision the three stable UAT accounts (applicant,
   mentor, admin), enrol TOTP for each, and write
   `e2e/uat/.uat-secrets.json`.
4. Runs Playwright targeting `e2e/auth.spec.ts` and
   `e2e/workflow-smoke.spec.ts` only.  Playwright reuses the dev servers
   started in step 1.
5. Tears down the dev servers and exits with the Playwright exit code.

**No API or UI server needs to be running beforehand.  No prior `seed:uat`,
`uat:setup`, or `pnpm dev` run is required.**

### Preconditions

| Requirement | How to satisfy |
|---|---|
| `root .env.local` exists | Copy `.env.example` and fill in `DATABASE_URL`, `SESSION_SECRET`, `ALLOWED_ORIGIN`, etc. |
| Database schema is migrated | `pnpm --filter @asp/api db:migrate` (one-time after each schema change) |
| Playwright browsers installed | `pnpm exec playwright install chromium` (one-time) |

### Environment variables loaded by the runner

The runner merges the following sources (later values win):

| Source | Purpose |
|---|---|
| `process.env` | Current shell environment |
| `root .env.local` | Operator's local overrides (DATABASE_URL, SESSION_SECRET, …) |
| `e2e/.env.uat` | UAT-specific overrides: `UAT=true`, `MAILER_PROVIDER=console` |

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | *(required)* | Postgres connection string for seed:uat |
| `SESSION_SECRET` | *(required)* | Passed to the API server |
| `ALLOWED_ORIGIN` | `http://localhost:6081` | API CORS origin |
| `MFA_ENABLED` | `true` | Set in .env.local |
| `PORT` | `6080` | API listen port |
| `NODE_ENV` | `development` | Set in .env.local |
| `UAT` | `true` | Forced by `e2e/.env.uat`; registers `/api/uat/*` routes |
| `MAILER_PROVIDER` | `console` | Forced by `e2e/.env.uat`; no live email required |
| `API_BASE` | `http://localhost:6080` | Passed to seed:uat |
| `BASE_URL` | `http://localhost:6081` | Playwright base URL |

> **Note:** `pnpm uat` always starts `pnpm dev` (dev servers) regardless of the
> `CI` environment variable — it strips `CI` before invoking Playwright to force
> `reuseExistingServer: true`. It is a local UAT gate, not a replacement for the
> container-based E2E job in `.github/workflows/ci.yml`. To run E2E tests against
> the production container, use `pnpm test:e2e` with `CONTAINER_IMAGE=asp:local`.

### Exit-code contract

| Exit code | Meaning |
|---|---|
| `0` | Seeding succeeded and all targeted specs passed |
| `1` | Env validation failed, servers did not become ready, or seeding failed |
| `non-zero (Playwright)` | At least one spec failed |

## Auth stack

- **Identity:** Better Auth with TOTP (two-factor mandatory for all users)
- **Sessions:** HttpOnly cookie-based; captured as Playwright `storageState` JSON
- **storageState style:** file-backed per role — one JSON file per role written to
  `os.tmpdir()` and reused across test files in the same Playwright run

## Manual / step-by-step UAT

If you prefer to run the steps individually:

1. Start the dev servers:
   ```bash
   pnpm dev
   ```
2. Seed the UAT accounts:
   ```bash
   pnpm seed:uat
   ```
3. Run the UAT specs:
   ```bash
   pnpm exec playwright test e2e/auth.spec.ts e2e/workflow-smoke.spec.ts
   ```

## Adding a new role driver

1. Create a new file in `e2e/uat/`, e.g. `MentorDriver.ts`.
2. Import and implement the `AuthDriver` interface from `./AuthDriver.ts`.
3. Implement `setup(email, password)` to:
   a. Sign up the user via `POST /api/auth/sign-up`.
   b. Enable TOTP via `POST /api/auth/two-factor/enable` and capture the secret.
   c. Verify TOTP via `POST /api/auth/two-factor/verify-totp`.
   d. Perform any role-specific promotion (e.g. admin: run `adminPromote.ts`;
      mentor: have an admin create a `mentor_grant` row).
   e. Sign in via the UI, wait for the post-login URL, and call
      `page.context().storageState({ path: this.storageStatePath })`.
4. Set `storageStatePath` to a unique `path.join(os.tmpdir(), 'asp-<role>-session.json')`.
5. Set `role` to the human-readable label (e.g. `'mentor'`).
6. Use the driver in your spec:
   ```ts
   import { MentorDriver } from './MentorDriver';
   const driver = new MentorDriver();
   test.beforeAll(async () => driver.setup(email, password));
   test.use({ storageState: driver.storageStatePath });
   ```

## Files

| File            | Description                                                        |
|-----------------|--------------------------------------------------------------------|
| `run-uat.ts`    | Single-command UAT runner (seed → servers → E2E → teardown)        |
| `setup-all.ts`  | Step-by-step session setup (for manual / iterative runs)           |
| `AuthDriver.ts` | TypeScript interface all role drivers must implement               |
| `README.md`     | This file                                                          |
