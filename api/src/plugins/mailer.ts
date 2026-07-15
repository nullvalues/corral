/**
 * Fastify plugin that decorates the instance with `mailer`.
 *
 * Wrapped with `fastify-plugin` so the decoration escapes the plugin's
 * encapsulation context and is visible on the root `app.mailer` handle.
 * This keeps route handlers free of any direct knowledge of where the
 * `MailerClient` was built — they read `fastify.mailer` and call methods on
 * the seam interface.
 *
 * The composition root (`buildApp`) injects the client through the plugin
 * options: in tests a fake; in `src/index.ts` the default (ConsoleMailerAdapter
 * until a real provider is wired in a later phase). When no client is supplied,
 * the plugin falls back to `createMailerClient(config)` so the decoration is
 * always present and route code never has to null-check.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createMailerClient, type MailerClient } from '../lib/mailer.js';
import { config } from '../lib/config.js';

export interface MailerPluginOptions {
  /** Optional pre-built client; falls back to `createMailerClient(config)`. */
  client?: MailerClient;
}

const mailerPlugin: FastifyPluginAsync<MailerPluginOptions> = async (
  fastify: FastifyInstance,
  opts: MailerPluginOptions,
): Promise<void> => {
  const client = opts.client ?? createMailerClient(config);
  fastify.decorate('mailer', client);
};

export default fp(mailerPlugin, {
  name: 'asp-mailer',
});

declare module 'fastify' {
  interface FastifyInstance {
    /** Email-sending seam — see `src/lib/mailer.ts`. */
    mailer: MailerClient;
  }
}
