/**
 * Fastify plugin: GET /api/health
 *
 * This plugin is intentionally NOT wrapped with `fastify-plugin`. Routes must
 * stay encapsulated per Corral Talent's plugin-encapsulation rule: only cross-cutting
 * decorations (e.g. the storage / ai client seams) escape their plugin
 * boundary; route definitions do not.
 *
 * The route is unauthenticated by design — it is the liveness probe consumed
 * by the dev-time UI placeholder, container health checks, and any future
 * uptime monitor. Returning a constant body and never touching the DB or any
 * other downstream is what keeps the probe trustworthy: a 200 here means the
 * Fastify event loop is alive, no more.
 *
 * Mounted from `buildApp()` with prefix `/api`, so the effective path is
 * `/api/health` even though this file declares only `/health`.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const healthRoute: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.get('/health', async () => {
    return { status: 'ok' as const };
  });
};

export default healthRoute;
