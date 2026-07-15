/**
 * Custom error types for the @asp/api package.
 *
 * `ConfigError` — thrown by `src/lib/config.ts` when startup env validation
 * fails. The orchestrator (`src/index.ts`) is expected to let this surface as
 * an uncaught exception so the process exits non-zero on misconfiguration.
 * The message must NEVER include secret values (e.g. the raw `SESSION_SECRET`).
 *
 * `NotImplementedError` — placeholder used by stub seams (storage / AI clients)
 * created in INFRA-005 so that route handlers depending on those seams fail
 * loudly during Phase 1 rather than silently no-op.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
