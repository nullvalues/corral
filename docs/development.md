# Corral Talent — Developer Standup Guide

This is the day-to-day developer runbook: get the stack running locally, run
the test suites correctly, and keep the generated OpenAPI client in sync.
For "what and why" read `docs/brief.md`; for architectural decisions read
`docs/architecture.md`; for production deployment read `docs/operations.md`;
for manual QA read `docs/uat.md`.

---

## 1. Prerequisites

- **Node.js 20+**
- **pnpm** — `npm install -g pnpm` if not already installed (`packageManager: pnpm@9.15.9` is pinned in the root `package.json`)
- Access to a remote PostgreSQL instance (dev **and** test databases — Corral Talent does not use local Docker Postgres; see `docs/brief.md` "Constraints")
- **Docker** — only needed if you plan to build the production container image, or to run the UAT session-setup driver (Playwright/Chromium is launched internally by `pnpm uat:setup`)

---

## 2. Clone + install

```bash
git clone git@github.com:nullvalues/corral.git
cd corral
pnpm install
```

This is a pnpm monorepo with two workspace packages: `api` (`@asp/api`) and
`ui` (`@asp/ui`), plus root-level `e2e/` Playwright specs.

---

## 3. Environment

Copy the example env file and fill it in:

```bash
cp .env.example .env.local
```

`.env.local` at the repo root is read by `pnpm dev` (via each package's
`--env-file=.env.local`) and by root-level scripts (`pnpm uat`, `pnpm
uat:setup`, `pnpm seed:uat`). The `api/` package also reads its own
`api/.env.local` (create it separately, or symlink/copy — see `docs/uat.md`
"Environment setup" for a worked example of both files together).

The full table of every environment variable — type, requirement, default,
and notes — lives in `docs/operations.md` § "2. Configuration reference".
Read that table before setting values; do not duplicate it here.

**`DATABASE_URL_TEST`** deserves a callout because its absence changes test
behaviour non-uniformly (see Section 6 for the full explanation):

- Set `DATABASE_URL_TEST` in `api/.env.local` to a dedicated **test** database
  connection string — never the same database as `DATABASE_URL`.
- `api/vitest.config.ts` loads `DATABASE_URL_TEST` (and only that key) out of
  `api/.env.local` at config-load time (`loadDatabaseUrlTest()`, in
  `api/tests/loadDatabaseUrlTest.ts`), so a properly configured `.env.local`
  lets `pnpm typecheck && pnpm test` run green from a cold shell — no manual
  `export` needed.
- If `DATABASE_URL_TEST` is unset both in the shell and in `api/.env.local`,
  the integration test project's `globalSetup` (`api/tests/globalSetup.ts`)
  throws immediately: `Error: DATABASE_URL_TEST is required for integration
  tests`. This is a hard failure, **not** a graceful skip — the process exits
  non-zero and the whole `pnpm test` build gate fails (see Section 6).

---

## 4. Database

Corral Talent connects to a remote PostgreSQL server in every environment — there is no
local Docker Postgres. Provision two databases: one for dev (`DATABASE_URL`),
one dedicated to tests (`DATABASE_URL_TEST`).

**Migrations.** Migration files live in `api/drizzle/`, generated from the
Drizzle schema in `api/src/db/schema/`:

```bash
pnpm --filter @asp/api db:generate   # generate a new migration from schema changes
```

Applying migrations is an **operator action**, not something a builder/agent
runs automatically — see `docs/architecture.md` "DEVELOPER ACTION pattern".
Two apply paths exist:

- `pnpm --filter @asp/api db:migrate` — drizzle-kit's own migrate command.
  This is the path named in the DEVELOPER ACTION pattern for applying
  pending migrations to a remote (dev or prod-like) database.
- `pnpm --filter @asp/api migrate:run` — a standalone script
  (`api/src/scripts/migrate.ts`) that applies migrations programmatically via
  `drizzle-orm/postgres-js/migrator`. This is the same mechanism the
  production container's ENTRYPOINT `migrate` subcommand uses (see
  `docs/operations.md`), and is a convenient one-shot command for a fresh
  local clone.

Other `db:*` scripts (`api/package.json`), all operating against whichever
database `DATABASE_URL`/config resolves to at the time:

```bash
pnpm --filter @asp/api db:studio         # open Drizzle Studio against DATABASE_URL
pnpm --filter @asp/api db:push           # push schema directly (no migration file) — dev convenience only
pnpm --filter @asp/api db:test:clean     # DROP + recreate public/drizzle schemas, re-migrate — TEST DB ONLY (safety-guarded)
pnpm --filter @asp/api db:test:truncate  # TRUNCATE all app tables RESTART IDENTITY CASCADE — TEST DB ONLY
pnpm --filter @asp/api db:test:wipe      # DROP named tables CASCADE, re-migrate — TEST DB ONLY
pnpm --filter @asp/api db:test:seed      # insert test reference data — TEST DB ONLY
```

The `db:test:*` family (backed by `api/src/db/testdb.ts`) is safety-guarded:
every operation checks both `config.NODE_ENV === 'test'` **and** that the
resolved database name contains `test` before running any SQL. They refuse
to run against a database that doesn't look like a test database.

**Dev seeding.** Seed the VMCAS experience categories and other reference
data into your dev database:

```bash
pnpm --filter @asp/api db:seed      # or: pnpm --filter @asp/api seed:dev (identical script)
```

Both scripts run `node --env-file=.env.local --import=tsx/esm src/db/seed.ts`
and are idempotent (`onConflictDoNothing`) — safe to re-run.

---

## 5. Running the dev stack

```bash
pnpm dev
```

This runs `@asp/api` and `@asp/ui` concurrently:

| Port | Service |
|------|---------|
| 6040 | `@asp/api` (Fastify) |
| 6041 | `@asp/ui` (Vite) |
| 6042–6049 | Reserved for Corral Talent dev services (unassigned) |

All Corral Talent dev servers must bind in the **6040–6049** range — this is a project
convention enforced for `PORT` at the config-validation layer (`api/src/lib/config.ts`
rejects a `PORT` outside that range at startup). If you need to run an
additional local service (a mock, a worker, etc.), pick an unused port inside
6042–6049 rather than a port outside the range.

The Vite dev server proxies `/api/*` requests to `http://localhost:6040`
(`ui/vite.config.ts`), so the UI can be developed against the local API
without CORS friction.

---

## 6. Tests

The build gate for this project is:

```bash
pnpm typecheck && pnpm test
```

`pnpm test` is `pnpm -r --if-present test` — it runs `test` in every
workspace package that defines one: `@asp/api` and `@asp/ui`.

**`@asp/ui` `test`** is `vitest --run` against jsdom-based component/unit
tests. No database is involved.

**`@asp/api` `test`** is `vitest --run` with **no `--project` filter**,
which means it runs *both* Vitest projects defined in
`api/vitest.config.ts`:

- **`unit`** project — every `tests/**/*.test.ts` file except
  `*.integration.test.ts`. No database required to start the run; the
  project's `env` block force-sets `DATABASE_URL_TEST: ''` for its test
  workers. A handful of older files in this project (e.g. `db-003.test.ts`,
  `db-007.test.ts`, `db-010.test.ts`, `db-016.test.ts`, `db-017.test.ts`,
  `db-022.test.ts`) additionally guard their integration-style `describe`
  blocks with `describe.skipIf(!DATABASE_URL_TEST)`; because the unit
  project always forces that env var empty, these blocks always skip when
  run as part of the `unit` project — this **is** a graceful skip, but it
  only applies to these legacy files inside the `unit` project.
- **`integration`** project — every `tests/**/*.integration.test.ts` file
  (plus `tests/api-integration.test.ts`). This project's `globalSetup`
  (`api/tests/globalSetup.ts`) requires `DATABASE_URL_TEST` to be set in the
  real process environment. If it is **not** set (and not loaded from
  `api/.env.local` — see Section 3), `globalSetup` throws
  `Error: DATABASE_URL_TEST is required for integration tests` and the
  process exits non-zero. **There is no graceful skip for this project** —
  the header comment in `globalSetup.ts` is explicit: "NO GRACEFUL SKIP".

Practical consequence: running the documented build gate `pnpm typecheck &&
pnpm test` from a cold shell with **no** `DATABASE_URL_TEST` set anywhere
fails — the `integration` project's `globalSetup` throws and the whole `pnpm
test` invocation exits non-zero, taking down the `-r` recursive run. Set
`DATABASE_URL_TEST` in `api/.env.local` (Section 3) so the gate passes
without manual exports.

To iterate on API unit tests only, without touching a database:

```bash
pnpm --filter @asp/api test:unit          # unit project only
```

To run only the integration project (requires `DATABASE_URL_TEST`):

```bash
pnpm --filter @asp/api test:integration
```

---

## 7. E2E + UAT harness

Root-level Playwright config (`playwright.config.ts`) drives `e2e/*.spec.ts`
and the UAT scenario harness under `e2e/uat/`.

**Seed stable UAT accounts** (applicant, mentor, admin + a mentor grant +
one sample experience):

```bash
pnpm seed:uat
```

This runs `api/src/db/seed.uat.ts` against `DATABASE_URL` and is idempotent
(delete-and-recreate: it deletes and recreates all three UAT accounts and
their app-owned rows on every run — any existing sessions or enrolled TOTP
factors are wiped). It also writes the TOTP secrets sidecar file to
**`e2e/uat/.uat-secrets.json`** (gitignored — via `writeUatSecrets()` in
`api/src/db/seed-uat-helpers.ts`). This file is what `e2e/auth.spec.ts` and
`e2e/uat/drivers/BetterAuthTotpDriver.ts` read to authenticate as the UAT
accounts without a manual TOTP entry.

**Provision Playwright sessions for all three roles**:

```bash
pnpm uat:setup
```

This runs `e2e/uat/setup-all.ts`, which requires the API and UI dev servers
already running (`pnpm dev`) plus `DATABASE_URL` set. It provisions admin →
applicant → mentor sessions in that order and writes **`storageState` JSON
files and TOTP-secret sidecar files to `os.tmpdir()`** (e.g.
`<tmpdir>/uat-applicant.json` + `<tmpdir>/uat-applicant.json.totp-secret.txt`)
— **not** to `e2e/uat/.uat-secrets.json`. Do not confuse the two sidecar
locations: `pnpm seed:uat` → `e2e/uat/.uat-secrets.json` (committed-path,
gitignored, TOTP secrets only); `pnpm uat:setup` → `os.tmpdir()`
(storageState + per-role TOTP secret files, ephemeral).

**Run Playwright directly**:

```bash
pnpm test:e2e          # playwright test — all e2e/*.spec.ts
```

**Automated gate** (run this before any human UAT session):

```bash
pnpm uat
```

`e2e/uat/run-uat.ts` starts the dev servers, runs `pnpm seed:uat`, runs
`pnpm uat:setup`, then runs `e2e/auth.spec.ts` and
`e2e/workflow-smoke.spec.ts`, and tears everything down. Exit 0 means the
automated gate passed. See `docs/uat.md` for the full manual scenario
scripts and TOTP-enrolment walkthrough for human testers.

---

## 8. OpenAPI → typed client workflow

`ui/src/api-types.ts` is generated from the API's OpenAPI spec and committed
to the repo — the UI never imports runtime code from `api/` (layer
boundary). Regenerate it whenever an API route or Zod schema changes:

```bash
pnpm --filter @asp/api generate:openapi    # writes api/openapi.json (local: --env-file=.env.local)
pnpm --filter @asp/ui generate:types       # regenerates ui/src/api-types.ts from api/openapi.json
```

CI uses `pnpm --filter @asp/api generate:openapi:ci` (plain `tsx`, env vars
supplied by the CI runner) instead of the local variant, then runs a drift
check to confirm the committed `ui/src/api-types.ts` matches what
regeneration would produce — an uncommitted regeneration after a route
change fails CI.

**Re-run both commands whenever you:**
- add, remove, or change a route path/method
- change a request or response Zod schema
- change an error-response shape

---

## 9. Troubleshooting

**`ConfigError` at API startup.** `api/src/lib/config.ts` validates env vars
at module load time. Check the specific variable named in the error against
`docs/operations.md` § "2. Configuration reference" — the most common
causes are a `SESSION_SECRET` shorter than 64 chars, an empty
`ALLOWED_ORIGINS`, or a `PORT` outside `6040–6049`.

**`pnpm test` fails immediately with "DATABASE_URL_TEST is required for
integration tests".** See Section 6 — set `DATABASE_URL_TEST` in
`api/.env.local` to a dedicated test database connection string, or run
`pnpm --filter @asp/api test:unit` if you only need the unit project for
now.

**Database unreachable / migration failed.** See `docs/operations.md` §
"6. Incident response" for the full remote-Postgres connectivity and migration
failure runbooks — the causes and fixes are the same in dev as in
production, since Corral Talent always talks to a remote Postgres instance.

**UAT sign-in fails / "`.uat-secrets.json` not found".** Run `pnpm
seed:uat` first — it must run before `pnpm uat:setup` or any UAT Playwright
spec that authenticates via TOTP. If you've re-run `pnpm seed:uat` after an
earlier `pnpm uat:setup`, TOTP factors were wiped; re-run `pnpm uat:setup`
to re-provision sessions against the fresh accounts.

**UI shows stale/mismatched request or response shapes.** You likely
changed an API route or schema without regenerating the typed client — see
Section 8.

**CORS / 403 errors from the Vite dev proxy.** Confirm `ALLOWED_ORIGINS`
includes `http://localhost:6041` in your `api/.env.local` — see
`docs/architecture.md` ADR on Better Auth trusted-origins for why the Vite
proxy needs an explicit origin entry even in dev.
