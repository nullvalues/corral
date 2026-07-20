/**
 * UAT runner — single-command end-to-end UAT flow.
 *
 * Invocation:
 *   pnpm uat
 *
 * What it does (in order):
 *   1. Loads environment from the root .env.local and e2e/.env.uat files so
 *      that the spawned API server and seed script receive all required vars.
 *   2. Starts the monorepo dev servers (pnpm dev) in the background and waits
 *      for the API health endpoint to become ready.
 *   3. Runs pnpm seed:uat to provision the three stable UAT accounts, enrol
 *      TOTP, and write e2e/uat/.uat-secrets.json.
 *   4. Runs pnpm uat:setup to sign each UAT account in via the Better Auth HTTP
 *      API and write the pre-authenticated storageState files to os.tmpdir()
 *      that e2e/workflow-smoke.spec.ts loads.
 *   5. Runs playwright test targeting exactly e2e/auth.spec.ts and
 *      e2e/workflow-smoke.spec.ts.  Playwright reuses the already-running
 *      servers (reuseExistingServer is true when CI env is absent).
 *   6. Tears down the dev servers regardless of the Playwright result.
 *   7. Exits with 0 only when seeding, setup, and all targeted specs pass;
 *      exits non-zero on any earlier failure.
 *
 * Environment variables (read from root .env.local + e2e/.env.uat):
 *   DATABASE_URL       — required for seed:uat (Postgres connection string)
 *   SESSION_SECRET     — required for the API server
 *   ALLOWED_ORIGIN     — required for the API server (default http://localhost:6081)
 *   MFA_ENABLED        — default true
 *   PORT               — default 6080
 *   NODE_ENV           — default development
 *   UAT                — forced true (from e2e/.env.uat) — registers /api/uat/* routes
 *   MAILER_PROVIDER    — forced console (from e2e/.env.uat)
 *   API_BASE           — passed to seed:uat (default http://localhost:6080)
 *   BASE_URL           — Playwright base URL (default http://localhost:6081)
 *
 * Exit-code contract:
 *   0   — seeding and setup succeeded and all targeted specs passed
 *   1   — env validation failed, seed or setup failed, or servers never became ready
 *   non-zero from playwright — at least one spec failed
 *
 * Preconditions:
 *   - root .env.local exists and contains DATABASE_URL, SESSION_SECRET, etc.
 *   - The database schema is already migrated (pnpm --filter @asp/api db:migrate).
 *   - No prior pnpm dev, seed:uat, or uat:setup run is required.
 *
 * Teardown:
 *   The runner registers SIGINT and SIGTERM handlers to ensure the background
 *   dev-server process is killed even if the runner is interrupted.  The dev
 *   servers are always killed in a finally block so no orphaned process is left
 *   behind on success or failure.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the monorepo root (three levels up from e2e/uat/) */
const MONOREPO_ROOT = path.resolve(__dirname, '..', '..');

const ROOT_ENV_LOCAL = path.join(MONOREPO_ROOT, '.env.local');
const UAT_ENV_FILE = path.join(MONOREPO_ROOT, 'e2e', '.env.uat');

// Readiness probe: API health endpoint
const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6080';
const HEALTH_URL = `${API_BASE}/api/health`;

/** How long to wait for the API to become ready (ms) */
const READINESS_TIMEOUT_MS = 120_000;
/** How long between health-check polls (ms) */
const POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Env-file parser
// ---------------------------------------------------------------------------

/**
 * Parse a .env file into a key→value record.
 * Handles:
 *   - `KEY=value` assignments
 *   - Quoted values (`KEY="value"` / `KEY='value'`)
 *   - Comments (lines starting with #)
 *   - Blank lines
 * Does NOT expand variable references.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Env assembly
// ---------------------------------------------------------------------------

/**
 * Build the env for spawned child processes.
 *
 * Merge order (later values win):
 *   process.env (current process)
 *   → root .env.local (operator's local overrides)
 *   → e2e/.env.uat (UAT-specific overrides: UAT=true, MAILER_PROVIDER=console)
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const rootEnv = parseEnvFile(ROOT_ENV_LOCAL);
  const uatEnv = parseEnvFile(UAT_ENV_FILE);
  return {
    ...process.env,
    ...rootEnv,
    ...uatEnv,
  };
}

// ---------------------------------------------------------------------------
// Health-check poller
// ---------------------------------------------------------------------------

async function waitForReadiness(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`health check returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `API server at ${url} did not become ready within ${timeoutMs / 1000}s.\n` +
      `Last error: ${String(lastError)}`,
  );
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

/**
 * Spawn a command and inherit stdio. Resolves with the exit code.
 */
function spawnInherited(
  cmd: string,
  args: string[],
  opts: child_process.SpawnOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(cmd, args, { ...opts, stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('close', (code) => resolve(code ?? 1));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ── Env validation ──────────────────────────────────────────────────────

  if (!fs.existsSync(ROOT_ENV_LOCAL)) {
    console.error(`[uat] ERROR: ${ROOT_ENV_LOCAL} not found.`);
    console.error('[uat] Create it from .env.example and ensure DATABASE_URL, SESSION_SECRET, etc. are set.');
    process.exit(1);
  }

  const childEnv = buildChildEnv();

  if (!childEnv['DATABASE_URL']) {
    console.error('[uat] ERROR: DATABASE_URL is not set in the environment or .env.local.');
    process.exit(1);
  }

  // ── Start dev servers ───────────────────────────────────────────────────

  console.log('[uat] Starting dev servers (pnpm dev)…');

  const devProc = child_process.spawn('pnpm', ['dev'], {
    cwd: MONOREPO_ROOT,
    env: childEnv,
    stdio: 'inherit',
    // detached: false — we want the subprocess to die when we kill the runner
  });

  let devProcExited = false;
  devProc.on('close', () => {
    devProcExited = true;
  });

  // Ensure dev servers are killed on runner interruption
  function killDevServers(signal?: string): void {
    if (!devProcExited) {
      console.log(`\n[uat] Stopping dev servers${signal ? ` (${signal})` : ''}…`);
      devProc.kill('SIGTERM');
    }
  }

  process.on('SIGINT', () => {
    killDevServers('SIGINT');
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    killDevServers('SIGTERM');
    process.exit(143);
  });

  let playwrightExit = 1;

  try {
    // ── Wait for API readiness ────────────────────────────────────────────

    console.log(`[uat] Waiting for API to be ready at ${HEALTH_URL}…`);
    try {
      await waitForReadiness(HEALTH_URL, READINESS_TIMEOUT_MS);
    } catch (err) {
      console.error(`[uat] ${String(err)}`);
      process.exit(1);
    }
    console.log('[uat] API is ready.');

    // ── Run seed:uat ──────────────────────────────────────────────────────

    console.log('[uat] Running seed:uat…');
    const seedExit = await spawnInherited('pnpm', ['seed:uat'], {
      cwd: MONOREPO_ROOT,
      env: childEnv,
    });

    if (seedExit !== 0) {
      console.error(`[uat] seed:uat failed with exit code ${seedExit}`);
      process.exit(1);
    }
    console.log('[uat] seed:uat complete.');

    // ── Run uat:setup ─────────────────────────────────────────────────────
    //
    // workflow-smoke.spec.ts loads pre-authenticated storageState files from
    // os.tmpdir() (/tmp/uat-applicant.json, etc.). Those files are produced by
    // pnpm uat:setup (e2e/uat/setup-all.ts), which signs each UAT account in via
    // the Better Auth HTTP API and writes the storageState JSON. It hits the API
    // directly — no Vite or browser is required — so the already-running dev
    // servers and seeded accounts are sufficient. Must run after seed:uat (the
    // accounts and TOTP secrets must exist) and before Playwright (the
    // storageState files must exist when the smoke spec loads them).

    console.log('[uat] Running uat:setup…');
    const setupExit = await spawnInherited('pnpm', ['uat:setup'], {
      cwd: MONOREPO_ROOT,
      env: childEnv,
    });

    if (setupExit !== 0) {
      console.error(`[uat] uat:setup failed with exit code ${setupExit}`);
      process.exit(1);
    }
    console.log('[uat] uat:setup complete.');

    // ── Run Playwright against the two target specs ───────────────────────
    //
    // We do NOT forward process.env.CI into the playwright child env so that
    // playwright.config.ts sees reuseExistingServer: true and reuses the dev
    // servers we started above rather than attempting to start a second copy.
    // The UAT runner always manages server lifecycle itself.

    const playwrightEnv: NodeJS.ProcessEnv = {
      ...childEnv,
      // Ensure playwright uses the correct base URLs
      BASE_URL: childEnv['BASE_URL'] ?? 'http://localhost:6081',
      API_BASE: childEnv['API_BASE'] ?? 'http://localhost:6080',
      // Strip CI so playwright reuses the running servers
      CI: undefined,
    };

    console.log('[uat] Running Playwright specs: e2e/auth.spec.ts e2e/workflow-smoke.spec.ts…');
    playwrightExit = await spawnInherited(
      'pnpm',
      ['exec', 'playwright', 'test', 'e2e/auth.spec.ts', 'e2e/workflow-smoke.spec.ts'],
      {
        cwd: MONOREPO_ROOT,
        env: playwrightEnv,
      },
    );

    if (playwrightExit === 0) {
      console.log('[uat] All targeted specs passed.');
    } else {
      console.error(`[uat] Playwright exited with code ${playwrightExit} — one or more specs failed.`);
    }
  } finally {
    // ── Teardown ──────────────────────────────────────────────────────────
    killDevServers();
    // Give dev servers a moment to shut down gracefully
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  process.exit(playwrightExit);
}

main().catch((err: unknown) => {
  console.error('[uat] Unexpected runner error:', err);
  process.exit(1);
});
