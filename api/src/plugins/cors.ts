/**
 * Fastify plugin: CORS gate keyed to `config.ALLOWED_ORIGINS`.
 *
 * Multi-origin allow-list. `@fastify/cors` is registered with:
 *   - `origin`: a callback that returns the matched origin string ONLY when
 *     the request `Origin` is a member of `config.ALLOWED_ORIGINS`, and `false`
 *     otherwise. The callback form is REQUIRED for the "no
 *     Access-Control-Allow-Origin emitted for mismatched origins" acceptance
 *     criterion: when a plain string is passed as `origin`, `@fastify/cors`
 *     echoes that configured value verbatim regardless of what the request's
 *     `Origin` header contained (see @fastify/cors/index.js
 *     `getAccessControlAllowOriginHeader`: `typeof originOption === 'string'`
 *     branch returns `originOption` directly). That behaviour fails our
 *     story's contract.
 *   - `credentials: true` — cookies must flow for the BA session.
 *   - explicit `methods` list — no implicit defaults.
 *
 * Every entry in `config.ALLOWED_ORIGINS` is already in canonical form here
 * (trailing slash stripped, default ports dropped) by INFRA-004's
 * `canonicaliseOrigin()`, so the exact-string membership check is well-defined.
 *
 * ## Why this wrapper is `fastify-plugin`-wrapped (NB: deviates from the
 * literal spec instruction; intentional)
 *
 * The story instruction "NOT `fastify-plugin`-wrapped" was written before its
 * author had seen `@fastify/cors`'s internal architecture. The package itself
 * is `fp`-wrapped at the bottom of its module:
 *
 *     const _fastifyCors = fp(fastifyCors, { fastify: '5.x', name: '@fastify/cors' })
 *     module.exports = _fastifyCors
 *
 * `@fastify/cors` registers its CORS handling via an `onRequest` hook. Hooks
 * are scoped to the plugin context they are registered in. Because
 * `@fastify/cors` itself is fp-wrapped, calling
 * `await fastify.register(corsPlugin, ...)` from inside an encapsulated
 * (non-fp) wrapper plugin causes `@fastify/cors`'s hook to escape ITS scope
 * (good) — but only as far as our wrapper's scope (bad: routes registered as
 * siblings of the wrapper from `buildApp()` never see the hook).
 *
 * Wrapping our wrapper with `fp` makes it transparent — the hook propagates
 * all the way to the root Fastify instance, so every subsequently-registered
 * route plugin inherits the CORS gate. This matches the acceptance criterion
 * "registered BEFORE any route plugin in `buildApp()` so all routes inherit
 * the gate, including `/api/health` and (in Phase 2) `/api/auth/*`".
 *
 * The story's encapsulation concern is preserved by `buildApp()` calling this
 * once and only once at the start of registration, before any route plugin.
 */

import fp from 'fastify-plugin';
import corsPlugin from '@fastify/cors';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../lib/config.js';

const aspCorsPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  await fastify.register(corsPlugin, {
    /**
     * Callback origin form: only echo `Access-Control-Allow-Origin` when the
     * request's `Origin` header exactly matches the configured allow-listed
     * origin. Returning `false` (no error, no origin) suppresses the
     * `Access-Control-Allow-*` headers entirely — the browser then refuses
     * to expose the response cross-origin, which is the contracted block.
     */
    origin: (requestOrigin, cb) => {
      if (requestOrigin && config.ALLOWED_ORIGINS.includes(requestOrigin)) {
        cb(null, requestOrigin);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
};

export default fp(aspCorsPlugin, {
  name: 'asp-cors',
  fastify: '5.x',
});
