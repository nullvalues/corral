/**
 * Fastify plugin: per-group rate limiting for auth and applicant mutation
 * endpoints (API-024, INFRA-053).
 *
 * Registers `@fastify/rate-limit` globally but with an `allowList` function
 * that returns `true` (pass-through / no limit applied) for any request whose
 * URL does NOT match one of the targeted paths. Only these paths are
 * actively rate-limited:
 *
 *   POST /api/auth/sign-in*
 *   POST /api/auth/sign-up*
 *   POST /api/auth/two-factor/verify-totp
 *   POST /api/auth/request-password-reset
 *   POST /api/auth/reset-password
 *   POST /api/auth/change-password
 *   POST /api/experiences  (and PATCH /api/experiences/:id/verification)
 *   POST /api/mentor-grants/requests
 *
 * Three per-group limits (all share RATE_LIMIT_WINDOW_MS, default 60 000 ms):
 *   auth group  — RATE_LIMIT_MAX_AUTH (default 10): sign-in, sign-up,
 *                 request-password-reset, reset-password, change-password
 *   mfa group   — RATE_LIMIT_MAX_MFA (default 10): two-factor/verify-totp
 *   api group   — RATE_LIMIT_MAX_API (default 30): experiences, mentor-grants/requests
 *
 * Groups use isolated counters via the keyGenerator so consuming the auth
 * bucket does not affect the API bucket and vice-versa.
 *
 * The plugin is `fastify-plugin`-wrapped so that the rate-limit decorations
 * propagate to the root Fastify instance (same encapsulation pattern as
 * `plugins/cors.ts`).
 *
 * Error response: 429 with `{ "error": "Too Many Requests" }`.
 *
 * In-memory store only — no Redis required.
 */

import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../lib/config.js';

/** URL prefixes that should be rate-limited. */
const RATE_LIMITED_PREFIXES = [
  '/api/auth/sign-in',
  '/api/auth/sign-up',
  '/api/auth/two-factor/verify-totp',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/change-password',
  '/api/experiences',
  '/api/mentor-grants/requests',
];

/** Loopback IP addresses that are always exempt from rate limiting. */
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(ip: string): boolean {
  return LOOPBACK_IPS.has(ip);
}

function isRateLimitedPath(url: string): boolean {
  return RATE_LIMITED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Map a request URL to one of three rate-limit groups.
 *
 * Order matters: the MFA check must run before the generic /api/auth/ check
 * so that verify-totp is classified as 'mfa' rather than 'auth'.
 */
function groupFor(url: string): 'mfa' | 'auth' | 'api' {
  if (url.startsWith('/api/auth/two-factor/verify-totp')) return 'mfa';
  if (
    url.startsWith('/api/auth/sign-in') ||
    url.startsWith('/api/auth/sign-up') ||
    url.startsWith('/api/auth/request-password-reset') ||
    url.startsWith('/api/auth/reset-password') ||
    url.startsWith('/api/auth/change-password')
  ) return 'auth';
  return 'api';
}

/** Return the configured request cap for the group that owns this URL. */
function limitFor(url: string): number {
  const group = groupFor(url);
  if (group === 'mfa') return config.RATE_LIMIT_MAX_MFA;
  if (group === 'auth') return config.RATE_LIMIT_MAX_AUTH;
  return config.RATE_LIMIT_MAX_API;
}

const rateLimiterPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  const timeWindow = config.RATE_LIMIT_WINDOW_MS ?? 60_000;

  await fastify.register(rateLimit, {
    // Dynamic per-request limit based on the group the URL falls into.
    max: (req: FastifyRequest) => limitFor(req.url),
    timeWindow,
    // Per-group key prevents cross-bucket contamination: an auth-limited client
    // does not consume the API bucket, and vice-versa.
    keyGenerator: (req: FastifyRequest) => `${groupFor(req.url)}:${req.ip}`,
    // allowList returns true → request is allowed without consuming quota.
    // Loopback callers (127.0.0.1, ::1, ::ffff:127.0.0.1) are always exempt —
    // the rate limiter defends against external abuse, not local tooling.
    // For all other callers, only targeted auth paths are rate-limited.
    allowList: (request: FastifyRequest, _key: string) => {
      if (isLoopback(request.ip)) return true;
      return !isRateLimitedPath(request.url);
    },
    errorResponseBuilder: (_request: FastifyRequest) => {
      // statusCode must be present in the returned object so Fastify's error
      // handler sets the HTTP status correctly (defaults to 500 otherwise).
      return { statusCode: 429, error: 'Too Many Requests' };
    },
    // Use the default in-memory store (no Redis dependency).
  });
};

export default fp(rateLimiterPlugin, {
  name: 'asp-rate-limiter',
  fastify: '5.x',
});
