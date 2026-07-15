/**
 * Fastify plugin: static SPA serving for single-origin production deployment.
 *
 * When `config.STATIC_UI_ROOT` is set, this plugin:
 *   1. Registers `@fastify/static` to serve files from the given directory.
 *   2. Adds a `GET /*` wildcard catch-all route that returns `index.html`,
 *      enabling client-side SPA routing (history-mode pushState URLs).
 *
 * When `config.STATIC_UI_ROOT` is unset (development mode, or API-only
 * deployments), this plugin is a strict no-op — no routes are added, no
 * filesystem paths are consulted.
 *
 * ## Why explicit routes win over the wildcard
 *
 * `@fastify/static` is registered with `wildcard: false`, which prevents it
 * from registering its own `/*` catch-all. Our explicit `GET /*` route is
 * registered AFTER `@fastify/static` and AFTER all `/api/*` routes (which are
 * registered by `buildApp()` before this plugin). Fastify's router resolves
 * explicit routes before wildcard routes, so registered `/api/*` endpoints are
 * never intercepted by the SPA fallback.
 *
 * However, an unregistered path under `/api/*` (e.g. `/api/nonexistent`) has
 * no explicit handler and would otherwise fall through to the `/*` wildcard,
 * returning index.html with a 200 — masking a genuine 404. To preserve the
 * API namespace, the wildcard handler explicitly returns a 404 JSON response
 * for any path beginning with `/api/`. This keeps the API route space clean
 * and consistent regardless of which routes happen to be registered.
 *
 * ## Plugin wrapping (fp)
 *
 * This plugin is `fastify-plugin`-wrapped so the `@fastify/static` decorator
 * and the `sendFile` method it adds to `reply` propagate to the root Fastify
 * instance (same pattern as `plugins/cors.ts`; see ADR-001 rationale). Without
 * `fp`, the decorator would be scoped to this plugin's encapsulated context and
 * `reply.sendFile` would not be visible to the wildcard route registered here.
 *
 * INFRA-013.
 */

import fp from 'fastify-plugin';
import FastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../lib/config.js';

const staticUiPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  if (!config.STATIC_UI_ROOT) {
    // No-op: dev mode or API-only deployment.
    return;
  }

  await fastify.register(FastifyStatic, {
    root: config.STATIC_UI_ROOT,
    wildcard: false,
  });

  // SPA fallback: any GET that didn't match an explicit route serves index.html
  // so the client-side router can handle the URL.
  //
  // Exception: paths under /api/* are never served index.html. A request to an
  // unregistered API path (e.g. /api/nonexistent) gets a 404 JSON response so
  // the API namespace is cleanly preserved — callers get a clear error rather
  // than a silent HTML response.
  fastify.get('/*', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/api') {
      return reply.status(404).send({ error: 'Not Found', statusCode: 404 });
    }
    return reply.sendFile('index.html');
  });
};

export default fp(staticUiPlugin, {
  name: 'asp-static-ui',
  fastify: '5.x',
});
