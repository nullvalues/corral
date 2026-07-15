/**
 * logCapture — extracts URLs from container stdout for E2E tests.
 *
 * CONTRACT SURFACE: The regex below matches the log line emitted by
 * ConsoleMailerAdapter.sendPasswordReset in api/src/lib/mailer.ts:
 *
 *   console.log(`[mailer] sendPasswordReset to=${opts.to} url=${opts.resetUrl}`);
 *
 * If that format changes, this regex MUST be updated to match.
 */

import { execFileSync } from 'child_process';

const CONTAINER_NAME = 'asp-e2e';
const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;
const LOG_TAIL_LINES = 20;

/**
 * extractResetUrl polls `docker logs asp-e2e` until it finds the password-reset
 * log line for the given email, then returns the captured URL.
 *
 * Only available in CI (process.env.CI === 'true'). Throws immediately outside CI.
 *
 * @param email - The recipient email address to search for.
 * @param opts.timeoutMs - How long to poll before giving up (default: 10 000 ms).
 */
export async function extractResetUrl(
  email: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  if (process.env['CI'] !== 'true') {
    throw new Error(
      'extractResetUrl is only available in CI (process.env.CI must be "true"). ' +
        'Outside CI the mailer does not log to docker stdout.',
    );
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  // Regex matches: [mailer] sendPasswordReset to=<email> url=<url>
  // The email is escaped so special regex chars in the address are treated literally.
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\[mailer\\] sendPasswordReset to=${escapedEmail} url=(\\S+)`,
  );

  while (Date.now() < deadline) {
    const logs = getContainerLogs();

    for (const line of logs.split('\n')) {
      const match = pattern.exec(line);
      if (match) {
        return match[1]!;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Timed out — include the last N lines for diagnostics.
  const logs = getContainerLogs();
  const lastLines = logs.split('\n').slice(-LOG_TAIL_LINES).join('\n');

  throw new Error(
    `extractResetUrl: timed out after ${timeoutMs} ms waiting for password-reset log ` +
      `for email "${email}" in container "${CONTAINER_NAME}".\n` +
      `Last ${LOG_TAIL_LINES} lines of container logs:\n${lastLines}`,
  );
}

function getContainerLogs(): string {
  return execFileSync('docker', ['logs', CONTAINER_NAME], {
    encoding: 'utf8',
    // Merge stderr into the output — docker logs writes to stderr by default.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
