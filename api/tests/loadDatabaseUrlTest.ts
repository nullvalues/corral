/**
 * Cold-shell test-gate env loader (TEST-056, resolves CER-039).
 *
 * Reads ONLY `DATABASE_URL_TEST` out of the repo-root `.env.local` so the documented
 * gate `pnpm typecheck && pnpm test` runs green from a cold shell with neither
 * `DATABASE_URL_TEST` nor `NODE_ENV` exported.
 *
 * SINGLE-KEY WHITELIST: this loader deliberately copies out only the
 * `DATABASE_URL_TEST` line. Every other key in `.env.local` — in particular the
 * dev `DATABASE_URL` and `NODE_ENV=development` — is intentionally ignored. If
 * those leaked into the test process an integration run could target the dev
 * database; the whole point of this loader is to avoid that. It is NOT a
 * general-purpose dotenv reader, and adding more keys must be a deliberate
 * decision, not an accident.
 *
 * No runtime dependency: parses the file with a tiny line scanner; dotenv /
 * dotenv-cli are NOT added to package.json.
 *
 * Behaviour:
 *   - No-op when the env file does not exist (CI / no local env).
 *   - No-op when `DATABASE_URL_TEST` is already set on the target env (never
 *     override an explicitly-exported value — CI and reviewer subagents keep
 *     priority).
 *   - Otherwise sets `env.DATABASE_URL_TEST` to the parsed value with optional
 *     surrounding single/double quotes stripped.
 */
import { existsSync, readFileSync } from 'node:fs';

const KEY = 'DATABASE_URL_TEST';

/**
 * Extracts the `DATABASE_URL_TEST` value from raw `.env.local` file contents.
 * Returns `undefined` if the key is not present. Ignores every other key.
 */
export function parseDatabaseUrlTest(contents: string): string | undefined {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    // Tolerate a leading `export ` prefix (export DATABASE_URL_TEST=...).
    const bareKey = key.startsWith('export ') ? key.slice('export '.length).trim() : key;
    if (bareKey !== KEY) continue;

    let value = line.slice(eq + 1).trim();
    // Strip a single matching pair of surrounding quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

/**
 * Loads ONLY `DATABASE_URL_TEST` from the given env file into `env`.
 *
 * @param envFilePath absolute path to the `.env.local` file
 * @param env target env object to mutate (defaults to `process.env`)
 */
export function loadDatabaseUrlTest(
  envFilePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // Never override an explicitly-exported value.
  if (env[KEY]) return;
  // No-op when the file is absent (CI / no local env).
  if (!existsSync(envFilePath)) return;

  const value = parseDatabaseUrlTest(readFileSync(envFilePath, 'utf8'));
  if (value !== undefined && value !== '') {
    env[KEY] = value;
  }
}
