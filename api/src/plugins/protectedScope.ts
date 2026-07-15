/**
 * Protected scope plugin.
 *
 * NOT wrapped with fastify-plugin — Fastify's encapsulation boundary is the
 * gate. Routes registered under this plugin's child scope are subject to both
 * session loading and MFA gate enforcement. Routes registered outside (health,
 * auth) remain public.
 *
 * Layer model: this plugin imports ONLY Fastify types (from the `fastify`
 * package, which is on the approved SDK list for plugins/). The concrete
 * service implementations (session loader registrar + MFA gate) are injected
 * via `ProtectedScopeOpts` by `app.ts`, which is the composition root and is
 * allowed to import from both plugins/ and services/.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type HookRegistrar = (fastify: FastifyInstance) => void;

export interface ProtectedScopeOpts {
  /**
   * Registers the session loader decorators and preHandler hook on the given
   * Fastify (child) instance.  Provided by services/auth/sessionLoader.ts.
   */
  registerSessionLoader: HookRegistrar;
  /**
   * The MFA grace-window preHandler.  Provided by services/auth/mfaGate.ts.
   */
  mfaGate: PreHandler;
  /**
   * Route plugins to register inside the protected scope. Each is registered
   * with prefix '/api'. Added in API-012 to support DI of route plugins from
   * app.ts without violating the layer model.
   */
  routePlugins?: FastifyPluginAsync[];
}

/**
 * All routes registered within this plugin's scope are subject to:
 *   1. Session loading (request.user / request.session populated)
 *   2. MFA gate (403 when past grace and twoFactor not enabled)
 *
 * Phase 6+ routes (experiences, etc.) are registered here via routePlugins.
 */
export async function protectedScopePlugin(
  fastify: FastifyInstance,
  opts: ProtectedScopeOpts,
) {
  opts.registerSessionLoader(fastify);
  fastify.addHook('preHandler', opts.mfaGate);
  for (const plugin of opts.routePlugins ?? []) {
    await fastify.register(plugin, { prefix: '/api' });
  }
}
