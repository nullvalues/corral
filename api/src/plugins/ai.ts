/**
 * Fastify plugin that decorates the instance with `aiClient`.
 *
 * Wrapped with `fastify-plugin` so the decoration escapes the plugin's
 * encapsulation context and is visible on the root `app.aiClient` handle.
 * This keeps route handlers free of any direct knowledge of where the
 * `AiClient` was built — they read `fastify.aiClient` and call methods on
 * the seam interface.
 *
 * The composition root (`buildApp`) injects the client through the plugin
 * options: in tests a fake; in `src/index.ts` the default stub (until the
 * real factory ships in a later phase). When no client is supplied, the
 * plugin falls back to `buildAiClient()` so the decoration is always
 * present and route code never has to null-check.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { buildAiClient, type AiClient } from '../lib/ai.js';

export interface AiPluginOptions {
  /** Optional pre-built client; falls back to `buildAiClient()`. */
  client?: AiClient;
}

const aiPlugin: FastifyPluginAsync<AiPluginOptions> = async (
  fastify: FastifyInstance,
  opts: AiPluginOptions,
): Promise<void> => {
  const client = opts.client ?? buildAiClient();
  fastify.decorate('aiClient', client);
};

export default fp(aiPlugin, {
  name: 'asp-ai',
});

declare module 'fastify' {
  interface FastifyInstance {
    /** External AI provider seam — see `src/lib/ai.ts`. */
    aiClient: AiClient;
  }
}
