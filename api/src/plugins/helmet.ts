/**
 * Fastify plugin: security headers via @fastify/helmet (INFRA-050).
 *
 * Registers @fastify/helmet with an explicit Content Security Policy and
 * conditional HSTS:
 *
 *   - CSP: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
 *          img-src 'self' data:; connect-src 'self'
 *   - HSTS: enabled only in production (process.env.NODE_ENV === 'production') so
 *           local HTTP development is not poisoned by a Strict-Transport-Security header.
 *   - All other helmet defaults (X-Frame-Options, X-Content-Type-Options, etc.) remain
 *     enabled.
 *
 * The plugin is `fastify-plugin`-wrapped so that security headers apply to every
 * response — API routes and static UI assets alike — consistent with the fp-wrapped
 * pattern established by `plugins/cors.ts` (ADR-001).
 */

import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const aspHelmetPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  const isProduction = process.env['NODE_ENV'] === 'production';

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    // HSTS is only meaningful over HTTPS. Enable in production only — enabling
    // in dev/test with HTTP would cause browsers to refuse the HTTP origin after
    // the first visit (HSTS pin), breaking the local dev workflow.
    strictTransportSecurity: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  });
};

export default fp(aspHelmetPlugin, {
  name: 'asp-helmet',
  fastify: '5.x',
});
