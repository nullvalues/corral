# asp UAT Runbook

This document is the entry point for manual User Acceptance Testing (UAT). It covers environment setup, TOTP onboarding, and a table of contents linking to the four scenario documents. Read this document in full before running any scenario.

---

## Prerequisites

The following must be installed on the tester's machine before starting:

- **Docker** — required to run the UAT session-setup driver (Playwright/Chromium is launched internally).
- **Node.js 20+** — required to run pnpm scripts.
- **pnpm** — the project's package manager. Install with `npm install -g pnpm` if absent.
- **An authenticator app** — Google Authenticator or Authy on a mobile device. You will scan or paste a TOTP secret during setup.
- Access to the PostgreSQL database (credentials from the project operator).

---

## Environment setup

1. Copy `.env.example` to `.env.local` in the project root (not inside `api/` or `ui/`).

2. Fill in the required values:

   ```
   SESSION_SECRET=<≥64 random chars — generate with: openssl rand -hex 64>
   ALLOWED_ORIGINS=http://localhost:6041
   PORT=6040
   NODE_ENV=development
   DATABASE_URL=postgresql://user:pass@host:5432/asp
   MFA_ENABLED=true
   MFA_GRACE_HOURS=24
   VITE_API_URL=http://localhost:6040
   MAILER_PROVIDER=console
   UAT=true
   ```

   > **Note:** `MAILER_PROVIDER=console` means no real email is sent. Password-reset links are captured in memory and retrievable via `GET /api/uat/reset-links`. See the section below.
   >
   > **Note:** `UAT=true` is required for the reset-links endpoint to be registered. `UAT=true` is rejected by the server if `NODE_ENV=production`.

3. Also create `.env.local` inside the `api/` directory with at minimum:

   ```
   DATABASE_URL=postgresql://user:pass@host:5432/asp
   SESSION_SECRET=<same value as above>
   ALLOWED_ORIGINS=http://localhost:6041
   MAILER_PROVIDER=console
   UAT=true
   ```

---

## Running the seed

The UAT seed provisions three stable accounts (applicant, mentor, admin), a mentor grant, and a PII-bearing sample experience. Run it once before the first UAT session:

```bash
pnpm seed:uat
```

This runs against the database configured by `DATABASE_URL` in `api/.env.local`. **Re-running the seed deletes and recreates all three UAT accounts** — any active sessions or enrolled TOTP factors are wiped. Run `pnpm uat:setup` again after each re-seed to restore storageState files.

Default UAT accounts created by the seed:

| Role      | Email                    | Password         |
|-----------|--------------------------|------------------|
| Applicant | uat-applicant@asp.dev    | UatApplicant1!   |
| Mentor    | uat-mentor@asp.dev       | UatMentor1!      |
| Admin     | uat-admin@asp.dev        | UatAdmin1!       |

These values can be overridden via environment variables (`UAT_APPLICANT_EMAIL`, `UAT_APPLICANT_PASSWORD`, etc.) if needed, but the defaults are sufficient for standard UAT.

---

## Starting the API and UI

Open two terminal windows and run:

```bash
# Terminal 1 — start both servers
pnpm dev
```

This starts the API on `http://localhost:6040` and the UI on `http://localhost:6041` concurrently. Wait until both are ready before proceeding.

---

## Setting up TOTP for each role

Because asp requires TOTP (two-factor authentication) for all accounts, each UAT session must be provisioned with an authenticator-app secret before scenarios can be run.

**Run the setup script once** (after the seed and with both servers running):

```bash
pnpm uat:setup
```

This script provisions a Playwright browser session for each role (admin, applicant, mentor), enrolls TOTP for each account via the API, and writes two files for each role:

- A `storageState` JSON file (browser session) in your OS temp directory
- A TOTP secret sidecar file alongside it

**Finding the sidecar files:**

| Role      | Sidecar file                                       |
|-----------|----------------------------------------------------|
| Applicant | `<os.tmpdir()>/uat-applicant.json.totp-secret.txt` |
| Admin     | `<os.tmpdir()>/uat-admin.json.totp-secret.txt`     |
| Mentor    | `<os.tmpdir()>/uat-mentor.json.totp-secret.txt`    |

On Linux/macOS, `<os.tmpdir()>` is `/tmp`. On Windows it is typically `C:\Users\<you>\AppData\Local\Temp`.

**Enrolling the secret in an authenticator app:**

1. Open the relevant sidecar file. It contains a plain text string such as `JBSWY3DPEHPK3PXP`.
2. Open **Google Authenticator**: tap `+` → **Enter a setup key**.
   - Account name: enter anything (e.g. `asp-uat-applicant`).
   - Key: paste the string from the sidecar file.
   - Tap **Add**.
3. Open **Authy**: tap `+` → **Enter key manually**.
   - Enter the secret string, choose a name, and tap **Save**.
4. The authenticator app now shows a 6-digit code that rotates every 30 seconds. When the UI asks for a verification code, enter the current code displayed for the matching account.

> **Tip:** `pnpm uat:setup` also prints each TOTP secret and sidecar path to stdout. Check the terminal output if you need to find the path.

> **Note:** After enrollment, subsequent sign-ins go directly to the Experiences page — there is **no per-sign-in TOTP challenge prompt**. Your authenticator app codes are only needed if you manually re-enrol an account (e.g., after wiping the seed database and re-running `pnpm seed:uat`). The TOTP enrolment step runs once per account during `pnpm uat:setup`.

---

## Automated gate (run before human UAT)

Before walking through the manual scenarios, run the automated UAT suite to confirm the core auth and workflow paths pass:

```bash
pnpm uat
```

This command (implemented in `e2e/uat/run-uat.ts`) starts the dev servers, seeds the UAT database (`pnpm seed:uat`), runs `pnpm uat:setup` to write the pre-authenticated storageState files that `workflow-smoke.spec.ts` requires, runs `e2e/auth.spec.ts` and `e2e/workflow-smoke.spec.ts`, and tears everything down in one step. **No pre-running server or prior `pnpm seed:uat` is required** — the runner handles it. Exit 0 means the automated gate passed; non-zero means a failure must be investigated before proceeding to human UAT.

Once `pnpm uat` exits 0, the UAT database has been seeded and `.uat-secrets.json` is up to date. You can proceed directly to "Starting the API and UI" and then the scenario scripts.

---

## Scenario index

Run through each scenario in order. Each scenario document contains a step-by-step script with a Pass/Fail column for the tester to fill in.

| Scenario              | Document                                    | Roles involved        |
|-----------------------|---------------------------------------------|-----------------------|
| Applicant scenario    | [docs/uat/applicant-scenario.md](uat/applicant-scenario.md)   | Applicant             |
| Applicant momentum journey | [docs/uat/applicant-momentum-journey.md](uat/applicant-momentum-journey.md) | Applicant |
| Mentor scenario       | [docs/uat/mentor-scenario.md](uat/mentor-scenario.md)         | Mentor, Applicant     |
| Admin scenario        | [docs/uat/admin-scenario.md](uat/admin-scenario.md)           | Admin                 |
| Cross-cutting scenario| [docs/uat/cross-cutting-scenario.md](uat/cross-cutting-scenario.md) | All roles       |

After completing all four scenarios, complete the sign-off checklist in `docs/uat/sign-off.md`.

---

## Retrieving password-reset links during UAT

During UAT, the mailer is configured with `MAILER_PROVIDER=console`. No email is sent when a tester submits the "Forgot password" form. Instead, the reset link is held in an in-process ring buffer and can be retrieved via the UAT endpoint.

**Endpoint:** `GET /api/uat/reset-links`

**Preconditions:**
- `MAILER_PROVIDER=console` is set in the API environment.
- `UAT=true` is set in the API environment. Without `UAT=true` the endpoint is not registered and returns 404.

**How to retrieve the link:**

After submitting the "Forgot password" form in the UI, call:

```bash
curl http://localhost:6040/api/uat/reset-links
```

**Response shape:**

```json
[
  { "email": "uat-applicant@asp.dev", "url": "http://localhost:6041/reset-password?token=...", "sentAt": "2026-06-10T12:00:00.000Z" }
]
```

Find the entry matching the email address used in the form. Copy the `url` value and paste it into a browser tab. This opens the "Reset password" page with the token pre-populated.

The buffer holds the last 10 links. Earlier links are discarded when the buffer is full.

---

## Reporting defects

Record all failures in the defect log table in `docs/uat/sign-off.md`. Include:

- **ID** — sequential number (D-001, D-002, …)
- **Scenario** — which scenario document (e.g. Applicant, Mentor)
- **Step** — the step number or description from the scenario
- **Description** — what happened vs. what was expected
- **Severity** — Critical / High / Medium / Low
- **Status** — Open / Fixed / Deferred

Do not mark UAT as accepted until all Critical and High defects are resolved.
