# Operations Runbook — Corral Talent

## 1. Prerequisites

- **Docker 20+** installed locally for building container images
- **PostgreSQL instance** on your network or cloud provider (not local; see `docs/brief.md`)
- **pnpm** (Node.js package manager) for local development; optional for Docker deployments
- **curl** (or equivalent HTTP client) for health checks; included in the container image

---

## 2. Configuration reference

All env vars are read from `api/src/lib/config.ts`. The following table documents each variable with its type, requirement, default, and notes.

| Variable | Type | Required | Default | Example | Notes |
|----------|------|----------|---------|---------|-------|
| `SESSION_SECRET` | string (≥64 chars) | Yes | none | `openssl rand -hex 32 \| tr -d '\n'; openssl rand -hex 32` | Generate with: `openssl rand -hex 32` twice, concatenate both (64 hex chars total). Validates at startup; malformed value exits non-zero. Treat as secret — never log or commit. |
| `ALLOWED_ORIGINS` | comma-separated URL list | Yes | none | `http://localhost:6081` (dev) or `https://app.example.com,https://staging.example.com` (prod) | Comma-separated allow-list of UI origins. CORS requests whose `Origin` is not a member of the list are rejected. A single URL (no comma) is a one-element list. Each entry is trimmed; trailing slash and default ports (`:80` for http, `:443` for https) are normalised out at startup; every entry must be a valid URL and the list must be non-empty. The legacy singular `ALLOWED_ORIGIN` is still read as a fallback when `ALLOWED_ORIGINS` is unset (deprecated). |
| `PORT` | integer | No | `6080` | `6080` | Port the API listens on. Must be in range `6080–6089` (project constraint). Validates at startup. |
| `NODE_ENV` | enum: `development` \| `test` \| `production` | No | `development` | `production` | Controls feature gates (e.g. MFA mandatory in production, console mailer forbidden in production). |
| `MFA_ENABLED` | boolean (`true` \| `false`) | No | `true` | `true` | Mandatory TOTP-based multi-factor auth. MUST be `true` in production (enforced at config validation). |
| `MFA_GRACE_HOURS` | integer ≥0 | No | `24` | `24` | Grace period (hours) before new users must enrol in TOTP. 0 = mandatory immediate enrolment. |
| `DATABASE_URL` | Postgres URL | Yes | none | `postgresql://asp_user:password@your-db-host:5432/asp` | Full connection string: `postgresql://user:password@host:5432/dbname`. Validates as URL at startup. Treat as secret. |
| `STATIC_UI_ROOT` | absolute filesystem path | No | unset | `/app/ui/dist` | When set, the API serves the SPA from this directory (single-origin deployment). When unset (dev mode), the API is API-only; Vite serves the UI. In the container, set to `/app/ui/dist` (the builder copies the UI dist there). |
| `RATE_LIMIT_MAX` | integer (positive) | No | `10` | `100` | Max requests per window for auth endpoints. Overrides the built-in default (10 req/60s). |
| `RATE_LIMIT_WINDOW_MS` | integer (milliseconds, positive) | No | `60000` | `60000` | Time window (milliseconds) for rate-limit counter. Default is 60 seconds (60000 ms). |
| `MAILER_PROVIDER` | enum: `console` \| `resend` | No | `console` | `resend` (prod) or `console` (dev) | Email delivery provider. `console` logs to stdout (dev/test only). `resend` wires the Resend service. REJECTED in production (enforced at startup when `NODE_ENV=production`), unless `CI=true` — the CI exception allows the production image to run the E2E suite without a live mailer. |
| `MAILER_FROM` | email address string | Conditional | unset | `noreply@example.com` | Sender address for outbound email. REQUIRED when `MAILER_PROVIDER=resend`; optional for `console`. Must be a valid email. Treat as secret (email address exposure). |
| `RESEND_API_KEY` | string (API credential) | Conditional | unset | (Resend dashboard) | API key for Resend email service. REQUIRED when `MAILER_PROVIDER=resend`; ignored for `console`. Treat as secret — never log or commit. |

### Rate-limiter loopback bypass — topology constraint

The rate limiter exempts loopback IPs (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) from
all rate limits. This exemption relies on `trustProxy` being **off** (the current
default), which means `request.ip` is always the raw socket peer address — a forged
`X-Forwarded-For` header cannot spoof it.

**If a same-host reverse proxy (nginx, Caddy, etc.) is added**, all inbound connections
arrive from `127.0.0.1`, causing `request.ip` to return the proxy address for every
request and silently disabling auth rate limiting for all callers. Before adding a
same-host proxy, either:
- Set `trustProxy` and use a client-IP extraction strategy (e.g. `x-forwarded-for`
  header with validated proxy count), or
- Remove the loopback exemption from `rateLimiter.ts` and ensure UAT/seed tooling
  uses a non-loopback origin or a separate env gate.

---

## 3. First deploy

Follow these steps in order to bring up a fresh environment:

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/asp.git
   cd asp
   ```

2. **Create production environment file**
   ```bash
   cp .env.example .env.production
   ```
   Then edit `.env.production` with your values:
   ```
   SESSION_SECRET=<64 random hex chars>
   ALLOWED_ORIGINS=https://app.example.com
   NODE_ENV=production
   MFA_ENABLED=true
   DATABASE_URL=postgresql://asp_user:password@your-db-host:5432/asp
   MAILER_PROVIDER=resend
   MAILER_FROM=noreply@app.example.com
   RESEND_API_KEY=<your-resend-key>
   ```

3. **Build the Docker image**
   ```bash
   docker build -t asp:local .
   ```
   This two-stage build:
   - Installs all dev dependencies and builds the UI + API bundles
   - Creates a minimal runtime image with only production dependencies

4. **Run database migrations**
   ```bash
   docker compose run --rm asp migrate
   ```
   Waits for the database to be reachable, then applies all pending migrations in `api/drizzle/`. If a migration fails, fix the issue (see Incident response) and retry this command.

5. **Seed the database**
   ```bash
   docker compose run --rm asp seed
   ```
   Inserts the VMCAS experience categories and other initial data. Safe to re-run (uses `onConflictDoNothing`).

6. **Create the first admin user**
   ```bash
   docker compose run --rm asp admin:promote --email=admin@example.com
   ```
   Inserts an `admin` role grant for the specified email. The user must first sign up via the web UI, then this command grants the role. Only admin users can manage experience categories and mentor grants.

7. **Start the service**
   ```bash
   docker compose up -d asp
   ```
   Starts the container in the background.

8. **Verify health**
   ```bash
   curl http://localhost:6080/api/health
   ```
   Should return `{"status":"ok"}` (HTTP 200). If the service is not ready, check the logs:
   ```bash
   docker compose logs -f asp
   ```

---

## 4. Upgrading

When deploying a new version of the application:

1. **Pull or download the new code**
   ```bash
   git pull origin main
   ```

2. **Rebuild the Docker image** (if the code changed)
   ```bash
   docker build -t asp:local .
   ```

3. **Run database migrations** (if this version includes schema changes)
   ```bash
   docker compose run --rm asp migrate
   ```
   Safe to run even if no migrations exist (exits cleanly). Always run this step before restart; do not rely on auto-migration.

4. **Restart the service**
   ```bash
   docker compose up -d asp
   ```
   The `restart: unless-stopped` policy will immediately bring the new version online.

5. **Verify health**
   ```bash
   curl http://localhost:6080/api/health
   ```

---

## 5. Backup & restore

The Corral Talent container is **stateless** — all persistent state lives in the remote PostgreSQL database. No volumes or persistent mounts are used in the container.

**Backup strategy:**

Use your PostgreSQL backup tooling (e.g. `pg_dump`, managed database snapshots, WAL archival):

```bash
pg_dump postgresql://user:password@your-db-host:5432/asp > asp_backup.sql
```

**Restore strategy:**

Point Corral Talent at a restored Postgres instance by updating `DATABASE_URL` in `.env.production` and restarting the service. No application-layer restore steps are needed.

---

## 6. Incident response

### Where to look first

| Symptom | Likely cause | Section |
|---------|--------------|---------|
| Container exits immediately at startup with an `Invalid environment configuration` message | Missing or invalid env var | [Config validation error](#config-validation-error) |
| Logs show `ECONNREFUSED` or `Database connection failed` | API cannot reach PostgreSQL | [Database unreachable](#database-unreachable) |
| `docker compose run --rm asp migrate` exits with SQL errors | Bad migration file or inconsistent schema state | [Migration failed](#migration-failed) |
| `/api/health` does not return `{"status":"ok"}` | Service not yet ready, or crashed on startup — check config validation and database connectivity first | [Config validation error](#config-validation-error), [Database unreachable](#database-unreachable) |

### Config validation error

**Symptom:** Container exits immediately with error message like:
```
Invalid environment configuration:
  - SESSION_SECRET: value too short or too small
  - ALLOWED_ORIGINS: failed validation rule
```

**Cause:** One or more required environment variables are missing or invalid.

**Fix:**

1. Check `.env.production` for the missing variables listed in the error.
2. Verify values match the types in the **Configuration reference** table above.
3. For secrets like `SESSION_SECRET`, regenerate:
   ```bash
   openssl rand -hex 32
   ```
   (repeat twice and concatenate for ≥64 chars)
4. Rebuild and re-run:
   ```bash
   docker build -t asp:local .
   docker compose up -d asp
   ```

### Database unreachable

**Symptom:** Logs show:
```
Error: connect ECONNREFUSED (or similar connection error)
Database connection failed
```

**Cause:** The API cannot reach the PostgreSQL instance specified in `DATABASE_URL`.

**Fix:**

1. Verify the connection string in `.env.production`:
   ```bash
   grep DATABASE_URL .env.production
   ```
   Format must be `postgresql://user:password@host:5432/dbname`.

2. Test connectivity from your deployment host to the database host:
   ```bash
   nc -zv your-db-host 5432
   ```
   (if `nc` is not available, use `telnet your-db-host 5432`)

3. Check firewall rules: ensure the database host allows inbound connections on port 5432 from the container's network.

4. Verify Postgres credentials are correct: test locally if possible:
   ```bash
   psql postgresql://user:password@your-db-host:5432/asp -c "SELECT version();"
   ```

5. Once connectivity is confirmed, restart the service:
   ```bash
   docker compose restart asp
   ```

### Migration failed

**Symptom:** The `docker compose run --rm asp migrate` command exits with error output showing SQL syntax errors or constraint violations.

**Cause:** A migration file is invalid, or the database schema is in an inconsistent state.

**Fix:**

1. **Inspect the error output** from the failed migration command. The `api/drizzle/` directory contains all migrations in order (numbered `.sql` files).

2. **Check database state** to see which migrations have already been applied:
   ```bash
   psql postgresql://user:password@your-db-host:5432/asp -c "SELECT * FROM drizzle_migrations;"
   ```
   This shows all successfully applied migrations. Compare against the `.sql` files in `api/drizzle/` to identify which migration is failing.

3. **If the failed migration is data-destructive**, investigate the migration file itself:
   ```bash
   cat api/drizzle/<migration-name>.sql
   ```
   If the migration introduces a breaking change and the database cannot be recovered, restore from backup.

4. **If the migration is not data-destructive**, fix the root cause (e.g. wrong connection string, missing disk space on DB host) and retry:
   ```bash
   docker compose run --rm asp migrate
   ```

5. **For persistent migration issues**, contact the Corral Talent maintainers or create an issue on the project repository with the full error output and the output of `SELECT version();` from the database.

---
